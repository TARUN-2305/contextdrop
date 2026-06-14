const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('redis');

// Load environment variables from backend/.env
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const app = express();
const PORT = process.env.PORT || 4000;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'default-internal-secret-key-12345';
const DJANGO_API_URL = process.env.DJANGO_API_URL || 'http://localhost:8000';

app.use(cors());
app.use(express.json());

// Initialize Redis Client for Rate Limiting
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', err => console.error('Redis Client Connection Error', err));
redisClient.connect().then(() => {
  console.log('Connected to local Redis cache successfully.');
}).catch(err => {
  console.warn('Redis offline. Rate limiting will be bypassed.', err.message);
});

// Domain Specific System Prompt Tone Adjustments
const domainTones = {
  legal: "Use a highly formal and precise legal register. Focus on references to sections, clauses, and formal agreements. Include a brief disclaimer at the end stating that this response does not constitute legal advice.",
  medical: "Use a formal and clinical tone. Focus on accuracy and research grounding. You MUST append the following medical disclaimer at the very end of your response: '\\n*Disclaimer: This information is for educational purposes only and does not constitute medical advice. Consult a healthcare professional for clinical guidance.*'",
  academic: "Use an analytical, precise, and high-register academic tone. Focus heavily on methodologies, evidence, and logical structure.",
  technical: "Use a direct, clear, and structured technical register. Keep explanations concise, present code snippets or configurations where relevant, and use precise technical terminology.",
  business: "Use an actionable, executive, and summary-oriented business register. Focus on key takeaways, numbers, timelines, and deliverables.",
  general: "Use a helpful, clear, and professional tone."
};

// Main SSE Stream Endpoint
app.get('/stream/:slug', async (req, res) => {
  const { slug } = req.params;
  const question = req.query.q;
  const password = req.query.password || '';

  if (!question) {
    return res.status(400).json({ error: 'Question parameter q is required' });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // 1. IP-Based Rate Limiting via Redis
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const redisKey = `rate:ip:${clientIp}`;
  let requestCount = 0;

  try {
    if (redisClient.isOpen) {
      requestCount = await redisClient.incr(redisKey);
      if (requestCount === 1) {
        await redisClient.expire(redisKey, 60); // 1-minute window
      }
    }
  } catch (err) {
    console.error('Redis rate limit check error:', err.message);
  }

  if (requestCount > 5) {
    console.log(`Rate limit exceeded for IP: ${clientIp}`);
    res.write(`data: ${JSON.stringify({ text: "Error: Rate limit exceeded. Maximum 5 queries per minute." })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
    return;
  }

  let chunksData = [];
  let domain = 'general';

  // 2. Fetch relevant chunks from Django REST API (including password forwarding)
  try {
    const searchResponse = await fetch(`${DJANGO_API_URL}/api/capsules/${slug}/search`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ question, password })
    });

    if (searchResponse.status === 401) {
      console.log(`Access unauthorized for capsule: ${slug}`);
      res.write(`data: ${JSON.stringify({ text: "Access Denied: Correct password is required." })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    if (searchResponse.status === 410) {
      console.log(`Capsule expired: ${slug}`);
      res.write(`data: ${JSON.stringify({ text: "This capsule has expired and is no longer available." })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    if (!searchResponse.ok) {
      throw new Error(`Django search API returned status ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    chunksData = searchData.chunks || [];
    domain = searchData.domain || 'general';
  } catch (err) {
    console.error('Failed to retrieve capsule chunks from Django backend:', err.message);
    res.write(`data: ${JSON.stringify({ text: `[Error: Failed to connect to backend search context.]\n\n` })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
    return;
  }

  // 3. Format the retrieved document context
  let contextText = '';
  if (chunksData.length > 0) {
    contextText = chunksData.map((c, idx) => {
      const pageInfo = c.page_number ? `Page ${c.page_number}` : 'Unknown Page';
      const secInfo = c.section_title ? `, Section ${c.section_title}` : '';
      return `--- Excerpt ${idx + 1} (${pageInfo}${secInfo}) ---\n${c.text}\n---`;
    }).join('\n\n');
  } else {
    contextText = '[No relevant document excerpts found]';
  }

  // 4. Construct the grounded dynamic tone RAG prompt
  const activeTone = domainTones[domain] || domainTones.general;
  const systemPrompt = `You are a document assistant. You may ONLY answer questions using the provided document excerpts. If the answer is not in the excerpts, say exactly: "This document doesn't cover that." Do not use any outside knowledge. Always cite the source chunk (page number and section title) at the end of your answer in the format [Page X, Section Y].

Domain context: ${activeTone}`;

  const userPrompt = `Document excerpts:
${contextText}

User question: ${question}`;

  console.log(`Streaming query for capsule: ${slug} | Domain: ${domain}`);

  let fullReply = '';

  // 5. Try streaming using Groq Chat API (Primary), fallback to local Ollama (Offline)
  const groqApiKey = process.env.GROQ_API_KEY;
  const useGroq = groqApiKey && !groqApiKey.startsWith('YOUR_') && !groqApiKey.startsWith('gsk_3X7j3');

  if (useGroq) {
    try {
      console.log('Using Groq API for streaming completion...');
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`Groq API returned status ${response.status}`);
      }

      fullReply = await streamCompletion(response, res, 'groq');
      logAnalyticsHelper(slug, question, chunksData, fullReply);
      return;
    } catch (err) {
      console.error('Groq streaming failed, falling back to local Ollama:', err.message);
      res.write(`data: ${JSON.stringify({ text: `[Fallback to local Ollama offline assistant...]\n\n` })}\n\n`);
    }
  }

  // 6. Fallback: Local Ollama gemma4:e2b
  try {
    console.log('Using local Ollama gemma4:e2b for streaming completion...');
    const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const response = await fetch(`${ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma4:e2b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        options: {
          temperature: 0.1
        },
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API returned status ${response.status}`);
    }

    fullReply = await streamCompletion(response, res, 'ollama');
    logAnalyticsHelper(slug, question, chunksData, fullReply);
  } catch (err) {
    console.error('All LLM endpoints failed:', err.message);
    res.write(`data: ${JSON.stringify({ text: `Error: Unable to connect to LLM provider (both Groq and Ollama are offline).` })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
});

// Helper to stream chunks line by line
async function streamCompletion(response, clientRes, provider) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulatedText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep last incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (provider === 'groq') {
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') {
            continue;
          }
          try {
            const parsed = JSON.parse(dataStr);
            const token = parsed.choices[0]?.delta?.content;
            if (token) {
              accumulatedText += token;
              clientRes.write(`data: ${JSON.stringify({ text: token })}\n\n`);
            }
          } catch (e) {
            // ignore
          }
        }
      } else if (provider === 'ollama') {
        try {
          const parsed = JSON.parse(trimmed);
          const token = parsed.message?.content;
          if (token) {
            accumulatedText += token;
            clientRes.write(`data: ${JSON.stringify({ text: token })}\n\n`);
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  clientRes.write(`data: [DONE]\n\n`);
  clientRes.end();
  return accumulatedText;
}

// Helper to log analytics to Django
function logAnalyticsHelper(slug, question, chunksData, fullReply) {
  let wasAnswered = true;
  if (fullReply.includes("This document doesn't cover that.")) {
    wasAnswered = false;
  }
  const pageNumber = chunksData[0]?.page_number || null;

  fetch(`${DJANGO_API_URL}/api/capsules/${slug}/analytics`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${INTERNAL_API_KEY}`
    },
    body: JSON.stringify({
      question,
      was_answered: wasAnswered,
      page_number: pageNumber
    })
  }).then(async (res) => {
    if (!res.ok) {
      const txt = await res.text();
      console.error('Failed to log analytic response status:', res.status, txt);
    } else {
      console.log(`Successfully logged analytic for capsule: ${slug} | Answered: ${wasAnswered}`);
    }
  }).catch(err => console.error('Failed to log analytic to Django:', err.message));
}

app.listen(PORT, () => {
  console.log(`SSE Server running on port ${PORT}`);
});
