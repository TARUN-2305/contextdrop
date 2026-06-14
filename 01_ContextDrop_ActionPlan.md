# ContextDrop — Action Plan
### *"TinyURL for understanding."*
**Version 1.0 · June 2026**

---

## Research Summary: What the Market Misses

Existing tools like NotebookLM, AskYourPDF, and Humata solve the *reader's* problem — someone who already has access to a document and wants to query it. **None of them solve the *sender's* problem**: how do you share a document such that the recipient can actually understand it, ask questions about it, and act on it — without you fielding 12 follow-up calls?

Key gaps discovered from market research:
- Every tool requires the reader to sign up or create an account to ask questions.
- No tool generates a shareable, zero-friction link that turns a static document into a live Q&A session.
- Citation accuracy is the #1 failure mode: hallucinated quotes and wrong-page attribution destroy trust.
- Privacy is an afterthought — most consumer tools use documents to improve their models.
- No tool auto-detects document *domain* (legal, medical, technical, academic) and adjusts its tone accordingly.

**ContextDrop's differentiator**: the creator uploads once; the reader gets a clean URL, no login, no upload, just a conversation. The AI is sandboxed to *only* the document — it can't hallucinate from general knowledge.

---

## Product Vision

A professor uploads a 60-page research paper and shares `contextdrop.app/d/ax7k`. A student opens that link on their phone, asks "What is the core methodology?" and gets a cited, grounded answer pointing to page 14 — without installing anything, creating an account, or downloading the PDF.

The creator dashboard shows: 12 readers, 47 questions asked, 3 questions the AI couldn't answer (revealing gaps in the document itself).

---

## Core Feature Set

### Must-Have (MVP)

| Feature | Description |
|---|---|
| **Drop zone** | Drag-and-drop or paste URL. Accepts PDF, DOCX, TXT, and web URLs. |
| **Capsule link** | Auto-generated short URL (`/d/[slug]`) that is shareable without login. |
| **Reader chat** | Zero-login chat interface. Questions answered from document only, with inline page/section citations. |
| **Domain auto-detect** | NLP classifier identifies domain on ingest (legal, medical, academic, technical, business). Adjusts response style. |
| **TTL control** | Creator sets link expiry: 24 hours, 7 days, 30 days, or permanent. |
| **Source grounding** | Every answer includes `[Page X]` or `[Section Y]` citation. AI explicitly states when the document does not contain the answer. |

### High-Impact Features (V2)

| Feature | Why It Matters |
|---|---|
| **Unanswered questions log** | Creator sees which questions readers asked that the AI couldn't answer — powerful feedback loop for document authors. |
| **Suggested questions** | When reader opens the link, 3–5 auto-generated starter questions appear, lowering the blank-page barrier. |
| **Access control** | Password-protect a capsule link, or restrict by email domain (e.g., only `@company.com`). |
| **Reader analytics** | Heatmap of which pages/sections were most queried. Creator sees engagement without seeing individual reader identities. |
| **Multi-document capsule** | Bundle multiple files under one link (e.g., a contract + its amendment + the covering letter). |
| **Embed widget** | One-line `<script>` to embed the capsule chat widget on any webpage or documentation site. |

### Extraordinary Touches (V3)

| Feature | Why It Elevates the Tool |
|---|---|
| **"Dead ends" export** | Export all unanswered questions as a structured report for the document author to improve the source. |
| **Capsule forking** | A reader can request a "private copy" to annotate without affecting the shared capsule. |
| **Voice input** | Reader can speak their question (Web Speech API). Useful on mobile and for accessibility. |
| **Branded capsule pages** | Creator can set a logo and accent color so the link looks like their own product, not ContextDrop. |
| **Webhook on question** | Creator can receive a webhook notification every time a high-confidence-gap question is asked. |

---

## Design Philosophy

**The creator experience must feel like iLovePDF — fast, no clutter, no tutorial needed.**
**The reader experience must feel like WhatsApp — familiar chat, immediate, zero learning curve.**

### Color & Typography

The tool handles serious documents (legal, medical, technical). The aesthetic must signal trust and precision, not playfulness.

- **Primary palette**: Deep navy (`#0D1B2A`) as the hero surface. Warm white (`#F7F6F2`) for card backgrounds. Electric teal (`#00C9A7`) as the sole accent — used only for CTAs and active states.
- **Typography**: `IBM Plex Mono` for citation references and document excerpts (signals precision and traceability). `Inter` for all UI chrome and body copy. The mono/sans contrast is the visual signature of the brand.
- **No gradients, no illustrations**. Structure is decoration here — a document capsule is a precise artifact, and the UI should feel the same.

### Layout Principles

**Creator flow (single page, three states):**

```
State 1 — Empty:
┌─────────────────────────────────────────────────────────┐
│  [logo]                              [sign in]          │
│                                                         │
│         Drop a file or paste a URL                      │
│         ────────────────────────────                    │
│         [   large drop zone, 60% viewport   ]           │
│                                                         │
│         Supports PDF · DOCX · TXT · Web URLs            │
└─────────────────────────────────────────────────────────┘

State 2 — Processing:
┌─────────────────────────────────────────────────────────┐
│  [logo]                              [sign in]          │
│                                                         │
│         Research_Paper.pdf · 48 pages                   │
│         [████████████░░░░░]  Reading · 12 sec           │
│                                                         │
│         Identifying domain... Academic                  │
└─────────────────────────────────────────────────────────┘

State 3 — Ready:
┌─────────────────────────────────────────────────────────┐
│  contextdrop.app/d/ax7k            [Copy] [QR code]     │
│  Expires in: 7 days  ·  0 readers so far                │
│                                                         │
│  [Preview reader view]  [Set password]  [Edit expiry]  │
└─────────────────────────────────────────────────────────┘
```

**Reader flow (chat-first, document-secondary):**

```
┌──────────────────────────────────────────────┐
│  Research_Paper.pdf          [View PDF]       │
│  Shared by Prof. Rao                         │
│  ──────────────────────────────────────────  │
│                                              │
│  Suggested questions:                        │
│  • What is the core research question?       │
│  • What datasets were used?                  │
│  • What are the limitations?                 │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  [AI]  Hello! I can answer questions about   │
│        this paper. What would you like       │
│        to know?                              │
│                                              │
│  [User] What methodology did they use?       │
│                                              │
│  [AI]  The study used a mixed-methods        │
│        approach combining survey data...     │
│        [Page 14, Section 3.2]               │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │  Ask a question...             [→]  │    │
│  └─────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

### UX Micro-Decisions That Matter

- **The "I don't know" answer** is styled distinctly — soft amber background, honest language: *"This document doesn't appear to cover that. Here's what it does say about related topics..."* This builds trust more than a confident wrong answer.
- **Citations are tapable/clickable** and scroll the user to the relevant section in a side panel. The mono font on citation labels makes them feel like real academic references.
- **Reader identity is anonymous by default.** Analytics show aggregate patterns only, never individual session trails. Make this explicit on the reader's first load: *"Your questions are not saved or tracked personally."*
- **The drop zone is the full hero.** No marketing copy above it. The action is the landing page.

---

## Top-Down Architecture

### System Design Overview

```
[ Creator Browser ]                     [ Reader Browser ]
       │                                       │
  React Upload UI                      React Chat UI (no auth)
  (drag-drop + status)                 (SSE stream from Node)
       │                                       │
       ▼                                       ▼
[ Django REST API ]─────────────[ Node.js SSE Server ]
  /api/ingest                       /stream/[capsule_id]
  /api/capsule/create               Handles concurrent
  /api/capsule/[id]/analytics       reader sessions
       │                                       │
       ▼                                       ▼
[ Ingestion Pipeline ]              [ RAG Query Pipeline ]
  1. File → chunk (512 tokens,        1. Reader question → embed
     20% overlap)                     2. pgvector similarity search
  2. Docling/Unstructured parsing     3. Top-k chunks retrieved
  3. Domain classification (NLP)      4. Prompt: grounded-only LLM
  4. Embed via text-embedding-3-small 5. Citations extracted from
  5. Store → pgvector                    chunk metadata
       │
       ▼
[ PostgreSQL ]
  - capsules (id, creator, domain, ttl, settings)
  - chunks (capsule_id, text, page_num, embedding)
  - analytics (capsule_id, question_hash, answered, timestamp)

[ Redis ]
  - capsule session state (TTL enforcement)
  - rate limiting per reader IP
  - reader session context (last 5 exchanges)
```

### Technology Choices Mapped to Your Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend (creator) | React + React Dropzone | Familiar, drag-drop is one npm package |
| Frontend (reader) | React (served statically, no auth) | Reader URL loads a static SPA — fast, scalable |
| Real-time chat | Node.js + SSE | Django is sync-heavy; Node handles concurrent SSE streams better |
| REST API | Django REST Framework | Ingestion, auth, capsule CRUD — Django shines here |
| Ingestion parser | Docling (IBM open source) | Best layout-aware PDF parsing for academic + legal docs |
| Embeddings | OpenAI `text-embedding-3-small` | Cheap, fast, 1536 dimensions, excellent semantic quality |
| Vector store | pgvector (PostgreSQL extension) | Avoids a second database. Your Django ORM can query it directly. |
| LLM | Claude claude-sonnet-4-6 via API | Best for long-document, citation-grounded RAG |
| Cache | Redis 7 | TTL enforcement, rate limiting, reader context window |
| Object storage | AWS S3 (or Cloudflare R2) | Store original files; chunks in DB |

### Django Models (Key)

```python
class Capsule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    slug = models.CharField(max_length=8, unique=True)  # short URL component
    creator = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    domain = models.CharField(max_length=50)  # 'legal', 'medical', 'academic', etc.
    expires_at = models.DateTimeField()
    password_hash = models.CharField(max_length=128, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

class DocumentChunk(models.Model):
    capsule = models.ForeignKey(Capsule, on_delete=models.CASCADE)
    text = models.TextField()
    page_number = models.IntegerField(null=True)
    section_title = models.CharField(max_length=200, blank=True)
    embedding = VectorField(dimensions=1536)  # via pgvector
    chunk_index = models.IntegerField()

class CapsuleAnalytic(models.Model):
    capsule = models.ForeignKey(Capsule, on_delete=models.CASCADE)
    question_hash = models.CharField(max_length=64)  # SHA-256, never raw text
    was_answered = models.BooleanField()
    chunk_ids_used = ArrayField(models.IntegerField())
    asked_at = models.DateTimeField(auto_now_add=True)
```

### RAG Prompt (Grounded-Only Pattern)

```
System: You are a document assistant. You may ONLY answer questions using 
the provided document excerpts. If the answer is not in the excerpts, 
say exactly: "This document doesn't cover that." Do not use any outside 
knowledge. Always cite the source chunk (page number and section title) 
at the end of your answer in the format [Page X, Section Y].

Domain context: {domain} — adjust formality and terminology accordingly.

Document excerpts:
{retrieved_chunks}

User question: {question}
```

---

## Build Sequence (Top-Down)

### Phase 0 — Skeleton (Week 1–2)
- [ ] Django project init: `capsules` app, basic models, admin
- [ ] React app: single drop zone component, wires to `/api/ingest`
- [ ] Node.js SSE stub: `/stream/[id]` returns a hardcoded message
- [ ] Postgres + pgvector running locally via Docker
- **Milestone**: Upload a PDF, get a slug, open the reader URL, see "Hello" streamed

### Phase 1 — Core Pipeline (Week 3–4)
- [ ] Docling integration: PDF → chunks with page numbers
- [ ] OpenAI embedding of each chunk, stored to pgvector
- [ ] RAG query: embed question → top-5 retrieval → grounded LLM call
- [ ] SSE stream of LLM response to reader browser via Node.js
- [ ] Citation rendering in reader UI (mono font, tapable)
- **Milestone**: Ask a real question about a real PDF and get a grounded, cited answer

### Phase 2 — Trust Layer (Week 5–6)
- [ ] Domain classifier (zero-shot with LLM or a simple keyword classifier for MVP)
- [ ] TTL enforcement via Redis (capsule expiry)
- [ ] "I don't know" flow (amber card style when no chunks match)
- [ ] Rate limiting per reader IP (Redis)
- [ ] Password-protected capsules
- **Milestone**: Share a link with a friend. They can chat. Link expires after 7 days.

### Phase 3 — Creator Value (Week 7–8)
- [ ] Creator dashboard: reader count, question log (hashed), unanswered questions
- [ ] Suggested questions on reader open (auto-generated at ingest time)
- [ ] Analytics: which sections/pages were most queried
- [ ] Multi-format support: DOCX (python-docx), TXT, web URL (Playwright scrape)
- **Milestone**: A professor shares a paper. 5 students use it. Creator sees the gap report.

### Phase 4 — Polish & Scale (Week 9–10)
- [ ] Branded capsule pages (logo + accent color)
- [ ] Embed widget (`<script src="contextdrop.app/widget/[id].js">`)
- [ ] QR code generation for capsule links
- [ ] Voice input (Web Speech API)
- [ ] Deployment: Railway or Render (Django + Node + Redis + Postgres)
- **Milestone**: Public beta launch

---

## Monetization Model

| Tier | Price | Limits |
|---|---|---|
| Free | $0 | 3 capsules/month, 50-page limit, 7-day TTL max, ContextDrop branding |
| Pro | $9/month | Unlimited capsules, 500 pages, permanent TTL, analytics, password lock |
| Team | $29/month | Everything + branded pages, embed widget, multi-doc capsules, email-domain access control |
| API | Usage-based | Programmatic capsule creation, webhook support |

---

## Launch Positioning

**Tagline**: *Share documents that answer back.*

**Primary distribution**:
1. Post a demo on Twitter/X: upload a famous long paper (IPCC report, a 100-page legal ruling), share the ContextDrop link publicly. Let people ask it questions and screenshot the answers.
2. Submit to Product Hunt in the "AI Productivity" and "Document Tools" categories.
3. Target professors, lawyers, and technical writers on LinkedIn with a "I stopped getting 12 clarifying emails" hook.

**Retention loop**: Every reader session that hits an "I don't know" answer sends the creator a gap-report email. The creator comes back to improve the document. They create a new capsule. Repeat.

---

*End of ContextDrop Action Plan*
