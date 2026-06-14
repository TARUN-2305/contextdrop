import requests
import json
from django.conf import settings
from bs4 import BeautifulSoup

def chunk_text_by_pages(pages_dict, chunk_size=1000, overlap=200):
    """
    Chunks text page-by-page.
    pages_dict is a mapping of {page_number: page_text}
    Returns a list of dicts: [{'text': str, 'page_number': int, 'chunk_index': int}]
    """
    chunks = []
    chunk_index = 0

    for page_num, text in pages_dict.items():
        text = text.strip()
        if not text:
            continue

        # If the page is small enough, make it a single chunk
        if len(text) <= chunk_size:
            chunks.append({
                'text': text,
                'page_number': page_num,
                'chunk_index': chunk_index
            })
            chunk_index += 1
        else:
            # Slide window across page text
            start = 0
            while start < len(text):
                end = start + chunk_size
                chunk_text = text[start:end].strip()
                if chunk_text:
                    chunks.append({
                        'text': chunk_text,
                        'page_number': page_num,
                        'chunk_index': chunk_index
                    })
                    chunk_index += 1
                start += (chunk_size - overlap)

    return chunks

def get_embedding(text):
    """
    Generates embedding for a given text based on active provider.
    Returns a list of floats.
    """
    provider = getattr(settings, 'EMBEDDING_PROVIDER', 'ollama').lower()
    openai_key = getattr(settings, 'OPENAI_API_KEY', '')
    
    if provider == 'openai' and openai_key:
        try:
            headers = {
                "Authorization": f"Bearer {openai_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "input": text,
                "model": "text-embedding-3-small"
            }
            res = requests.post("https://api.openai.com/v1/embeddings", json=payload, headers=headers, timeout=10)
            res.raise_for_status()
            return res.json()["data"][0]["embedding"]
        except Exception as e:
            print(f"OpenAI embedding failed: {e}. Falling back to Ollama.")
            
    ollama_host = getattr(settings, 'OLLAMA_HOST', 'http://localhost:11434')
    try:
        payload = {
            "model": "nomic-embed-text",
            "prompt": text
        }
        res = requests.post(f"{ollama_host}/api/embeddings", json=payload, timeout=15)
        res.raise_for_status()
        return res.json()["embedding"]
    except Exception as e:
        print(f"Ollama API /api/embeddings failed: {e}. Trying /api/embed...")
        try:
            payload = {
                "model": "nomic-embed-text",
                "input": [text]
            }
            res = requests.post(f"{ollama_host}/api/embed", json=payload, timeout=15)
            res.raise_for_status()
            return res.json()["embeddings"][0]
        except Exception as ex:
            raise RuntimeError(f"Failed to generate embedding from Ollama: {ex}")

def classify_domain(sample_text):
    """
    Zero-shot classifies the document domain into legal, medical, academic, technical, business, general.
    """
    prompt = (
        "You are a document classifier. Classify this document snippet into exactly one of these categories: "
        "legal, medical, academic, technical, business, general.\n\n"
        "Respond with ONLY the category name in lowercase, nothing else. No punctuation, no explanation.\n\n"
        f"Snippet:\n{sample_text[:1500]}"
    )

    groq_key = getattr(settings, 'GROQ_API_KEY', '')
    if groq_key and not groq_key.startswith("YOUR_") and not groq_key.startswith("gsk_3X7j3"):
        try:
            headers = {
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "llama-3.3-70b-versatile",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": 10
            }
            res = requests.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers, timeout=10)
            res.raise_for_status()
            domain = res.json()["choices"][0]["message"]["content"].strip().lower()
            if domain in ['legal', 'medical', 'academic', 'technical', 'business', 'general']:
                return domain
        except Exception as e:
            print(f"Groq classification failed: {e}. Falling back to Ollama.")

    ollama_host = getattr(settings, 'OLLAMA_HOST', 'http://localhost:11434')
    try:
        payload = {
            "model": "gemma4:e2b",
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.1,
                "num_predict": 10
            }
        }
        res = requests.post(f"{ollama_host}/api/generate", json=payload, timeout=20)
        res.raise_for_status()
        domain = res.json()["response"].strip().lower()
        domain = ''.join(c for c in domain if c.isalnum())
        if domain in ['legal', 'medical', 'academic', 'technical', 'business', 'general']:
            return domain
    except Exception as e:
        print(f"Ollama classification failed: {e}")
        
    return "general"

def generate_suggested_questions(sample_text):
    """
    Generates exactly 3 relevant starter questions about the document snippet.
    Returns a list of strings.
    """
    prompt = (
        "Based on the following document excerpt, generate exactly 3 relevant, interesting starter questions "
        "that a reader might want to ask to understand the document.\n\n"
        "You MUST respond with ONLY a valid JSON array of strings containing the 3 questions. "
        "Do not include markdown tags (e.g. ```json), explanation, or other text outside the JSON block.\n\n"
        f"Excerpt:\n{sample_text[:2000]}"
    )
    
    default_questions = [
        "What is the core summary of this document?",
        "What are the key findings or takeaways?",
        "Are there any specific limitations or details mentioned?"
    ]

    groq_key = getattr(settings, 'GROQ_API_KEY', '')
    if groq_key and not groq_key.startswith("YOUR_") and not groq_key.startswith("gsk_3X7j3"):
        try:
            headers = {
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "llama-3.3-70b-versatile",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": 200
            }
            res = requests.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers, timeout=10)
            res.raise_for_status()
            text = res.json()["choices"][0]["message"]["content"].strip()
            # Clean up markdown code blocks if the LLM hallucinated them
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            parsed = json.loads(text.strip())
            if isinstance(parsed, list) and len(parsed) >= 3:
                return [str(q) for q in parsed[:3]]
        except Exception as e:
            print(f"Groq question generation failed: {e}. Falling back to Ollama.")

    # Fallback to local Ollama
    ollama_host = getattr(settings, 'OLLAMA_HOST', 'http://localhost:11434')
    try:
        payload = {
            "model": "gemma4:e2b",
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "num_predict": 200
            }
        }
        res = requests.post(f"{ollama_host}/api/generate", json=payload, timeout=20)
        res.raise_for_status()
        text = res.json()["response"].strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text.strip())
        if isinstance(parsed, list) and len(parsed) >= 3:
            return [str(q) for q in parsed[:3]]
    except Exception as e:
        print(f"Ollama question generation failed: {e}")

    return default_questions

def scrape_url_text(url):
    """
    Scrapes text from the paragraphs and headers of a given website URL.
    Returns a string containing parsed text.
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    # Prepend schema if missing
    if not url.startswith('http://') and not url.startswith('https://'):
        url = 'https://' + url

    try:
        res = requests.get(url, headers=headers, timeout=10)
        res.raise_for_status()
    except Exception as e:
        raise RuntimeError(f"HTTP request to web page failed: {str(e)}")

    soup = BeautifulSoup(res.content, 'html.parser')
    
    # Remove script and style elements
    for script in soup(["script", "style", "nav", "footer", "header"]):
        script.extract()

    # Get article or paragraph text
    paragraphs = soup.find_all(['h1', 'h2', 'h3', 'p'])
    text_content = []
    
    for p in paragraphs:
        p_text = p.get_text().strip()
        if p_text:
            text_content.append(p_text)

    full_text = "\n\n".join(text_content)
    
    if len(full_text.strip()) < 100:
        # Fallback: get raw body text if no standard paragraphs
        full_text = soup.body.get_text(separator='\n\n', strip=True) if soup.body else soup.get_text(separator='\n\n', strip=True)

    return full_text
