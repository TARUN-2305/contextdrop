# ContextDrop — Share Documents that Answer Back

> **TinyURL for understanding.** Upload a document or scrape a URL once, and share a secure, zero-friction conversational Q&A link with anyone. 

ContextDrop transforms static documents (PDFs, TXT) and web links into interactive, conversational knowledge capsules. It is designed to solve the **sender's problem**: instead of fielding dozens of follow-up emails and calls after sharing a document, creators can share a single link that answers readers' questions instantly, with absolute precision, zero sign-up friction, and inline source grounding.

---

## 🚀 Product Vision & Core Concept

When a user shares a document, they create a **Capsule**. A capsule represents a sandboxed RAG (Retrieval-Augmented Generation) context. 
* **Zero-Friction Reader Access**: Readers do not need to sign up, download files, or create accounts. They click the link, and immediately get a clean, familiar, messaging-style chat interface.
* **100% Grounded AI**: The AI is strictly sandboxed to the document. It does not hallucinate answers from external knowledge. If a question is not covered in the document, the AI explicitly states: *"This document doesn't cover that."*
* **Verification and Traceability**: Inline, clickable page citations (e.g., `[Page 3, Excerpt]`) accompany every answer so readers can verify the source in seconds.

---

## 🎨 System Architecture & Tech Stack

ContextDrop is a high-performance, three-tier full-stack application:

```
[ Creator Client ]                      [ Reader Client ]
        │                                      │
  React Upload UI                    React Chat UI (Zero-Auth)
  (Drag-drop & branding)             (SSE streaming reader pane)
        │                                      │
        ▼                                      ▼
[ Django REST API (Port 8000) ] ◄──► [ Node.js SSE Server (Port 4000) ]
  /api/ingest                        /stream/[slug]?q=...
  /api/capsules/[slug]/tags          Handles concurrent SSE
  /api/user/capsules                 client connections
        │                                      │
        ▼                                      ▼
[ Vector Similarity Engine ]            [ RAG Query Pipeline ]
  1. Parse (Docling/PDFPlumber)          1. Embed user query
  2. Text chunking & overlap             2. Retrieve top matching chunks
  3. Semantic embeddings                 3. Inject into grounded LLM prompt
  4. pgvector/SQLite search              4. Stream answer chunks via SSE
```

### Stack Breakdown
1. **Frontend**: React (TypeScript) + Vite. Styled with vanilla CSS, custom variables, and dark-theme glassmorphism aesthetics. Supports dynamic branding configurations.
2. **REST API Backend**: Django & Django REST Framework (DRF). Handles ingestion pipelines, user authentication, capsule CRUD, tag endpoints, and creator analytics calculations.
3. **SSE Server**: Node.js & Express. Designed to handle long-running HTTP connections for Server-Sent Events (SSE), streaming LLM responses to the client chunk-by-chunk with zero lag.
4. **Vector Search & Grounding**: Ingestion breaks documents into overlapping chunks, stores embeddings, and queries them using local semantic similarity search.
5. **Caching & Expiring (Redis)**: Tracks capsule sessions, enforces rate-limiting per reader IP, and manages the Link Time-To-Live (TTL) expiry.

---

## ⚡ Comprehensive Feature Guide

Here is a detailed breakdown of each individual feature on the ContextDrop platform:

### 1. Document Upload & Drop Zone
* **Drag-and-Drop Ingestion**: Drop files directly into the interactive drop zone or click to select them from the file explorer.
* **Supported Formats**: Accepts PDF and TXT files (supporting up to 50MB files).
* **Chunking Pipeline**: Files are processed using a structural parser, split into token chunks with a 20% overlap to ensure context is never lost across chunk boundaries, embedded, and indexed for similarity lookup.

### 2. Web Link Scraper / Ingest
* **URL-Based Capsules**: Switch to the "Paste Web Link" tab to scrape online articles, documentation pages, or wiki articles (e.g., fandom pages, blog posts).
* **Auto-Scraper**: Ingests raw HTML, cleans scripts and styles, and converts readable text blocks into chunks, letting readers chat with web content as easily as a PDF.

### 3. Capsule Title (Custom Naming)
* **Creator Customization**: Add a descriptive name in the *Capsule Title (Optional)* field before ingestion.
* **Global Dashboard Organization**: Instead of identifying capsules solely by random short-slug IDs (e.g., `d/m_dmcL69`), custom titles are tracked and displayed on your dashboard for quick reference.

### 4. Link Expiration (TTL Control)
* **Self-Deleting Content**: Enforce security by setting link lifespans. Options include **24 Hours**, **7 Days**, or **30 Days**.
* **Automatic Expiry**: Once the TTL expires, the capsule data is marked as expired, and all index files/records are deleted. Readers trying to access it will see a *"Capsule Expired"* screen.

### 5. White-Labeling & Custom Branding
* **Custom Logo URL**: Provide a URL for a custom icon/logo (PNG/SVG). It will dynamically replace the default ContextDrop logo in the reader's chat header.
* **Custom Accent Color**: Enter a HEX code or use the color-picker input. The application dynamically overrides the CSS custom properties (`--accent-color` and `--accent-hover`) for that specific capsule, custom styling all button elements, active states, tags, and highlights to match the creator's brand identity.

### 6. Security (Password Lock)
* **Access Restrictions**: Restrict document access by inputting a password.
* **Reader Gate**: Readers opening the shared link will encounter a lock screen requiring the password. Correct verification stores a local access session, allowing access to the Q&A session.

### 7. Automated Domain Classification
* **Zero-Shot Classifier**: On ingestion, the backend analyzes the document structure and vocabulary to classify it into a specific domain (e.g., **Academic**, **Legal**, **Medical**, **Technical**, **Business**, or **General**).
* **Dynamic AI Tone**: The domain is passed to the LLM agent system-prompt, adjusting the vocabulary and formality of the response.

### 8. Interactive Reader Chat Pane
* **Suggested Starter Questions**: On initial load, the chat presents 3–5 automatically generated questions based on the document's content, guiding the reader on where to begin.
* **Streaming Chat**: Utilizes Server-Sent Events (SSE) to render answers in real-time, word-by-word.
* **Voice Input (Web Speech API)**: Click the microphone icon next to the chat bar to dictate questions hands-free. Supported across modern browsers.

### 9. Grounded RAG with Inline Citations
* **Hallucination Sandbox**: Ensures the assistant only answers questions using retrieved excerpts. Questions not answerable by the text trigger a standardized fallback to prevent hallucinations.
* **Inline Reference Citations**: Answers contain click-to-verify citations (e.g. `[Page 1, Excerpt]`), allowing readers to inspect the source material.

### 10. QR Code Sharing
* **Mobile Ready**: The Ready page renders a high-quality QR code. Scanning it with a mobile device instantly loads the reader interface.

### 11. Iframe Chat Widget Embedding
* **Embedded Integration**: Generate iframe snippet code:
  ```html
  <iframe src="http://localhost:5173/d/[slug]?embed=true" width="100%" height="600" style="border:1px solid rgba(255,255,255,0.08); border-radius:12px; background:transparent;"></iframe>
  ```
* **Embed Mode Layout**: Adding `?embed=true` automatically hides the application header, navigation links, and back buttons, providing a clean, compact widget suited for blog posts or documentation portals.

### 12. Single Capsule Dashboard (Analytics)
* **Analytics Cards**: Displays key metrics including *Total Questions*, *Answered Queries*, and *Unanswered Queries (Gaps)*.
* **Query Heatmap**: Renders a bar chart representing which pages or segments of the document readers target most frequently.
* **Reader Gaps Log (Unanswered Questions)**: Lists queries that returned a gap warning. This helps creators identify missing details in their original source document.

### 13. User Authentication
* **Creator Workspace**: Register or log in to access the multi-capsule manager. Authenticated sessions are persisted using token headers.

### 14. Global Dashboard ("My Capsules")
* **Unified Management**: Lists all capsules created under the authenticated user.
* **Tag Management**: 
  - **Add Tags**: Type in a tag name and hit `Enter` to label capsules (e.g. `#legal`, `#marketing`).
  - **Remove Tags**: Click the `×` button next to any tag to immediately delete it.

---

## 🛠️ Setup & Development Guide

Follow these steps to run ContextDrop locally on your machine.

### Prerequisites
* Python 3.10+
* Node.js 18+
* Git
* Virtualenv

---

### Step 1: Clone & Configure Remote
Ensure your local workspace is linked to the correct repository:
```bash
git remote add chad https://github.com/Chad-di-Bear/contextdrop.git
```

---

### Step 2: Backend Setup (Django REST API)
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   python -m venv .venv
   # On Windows:
   .venv\Scripts\activate
   # On macOS/Linux:
   source .venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure environment variables in `backend/contextdrop/.env`:
   ```env
   SECRET_KEY=your-django-secret-key
   DEBUG=True
   ALLOWED_HOSTS=localhost,127.0.0.1
   OPENAI_API_KEY=your-openai-api-key # Or GROQ_API_KEY / OLLAMA_HOST
   ```
5. Apply database migrations:
   ```bash
   python manage.py makemigrations
   python manage.py migrate
   ```
6. Start the server:
   ```bash
   python manage.py runserver
   ```
   The backend will be available at `http://localhost:8000`.

---

### Step 3: SSE Server Setup (Node.js)
1. Navigate to the SSE server directory:
   ```bash
   cd sse-server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the node server:
   ```bash
   node index.js
   ```
   The streaming server will be available at `http://localhost:4000`.

---

### Step 4: Frontend Setup (React & Vite)
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables in `frontend/.env.local`:
   ```env
   VITE_API_URL=http://localhost:8000
   VITE_SSE_URL=http://localhost:4000
   VITE_APP_URL=http://localhost:5173
   ```
4. Start the frontend development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

## 🔗 How Embedding Works (Integration Walkthrough)

To verify the embed integration:
1. Open the [embed_test/index.html](file:///C:/Users/tarun/Desktop/USEFUL/Projects/ContextDrop%20-%20copy/ContextDrop/embed_test/index.html) file.
2. In it, the capsule viewer is loaded inside an `iframe`:
   ```html
   <iframe src="http://localhost:5173/d/[slug]?embed=true" width="100%" height="600" style="border:1px solid rgba(0,0,0,0.1); border-radius:12px; background:transparent;"></iframe>
   ```
3. Serving this page on a local web server (e.g. `python -m http.server 8080` in `embed_test/`) allows testing how external websites embed the chat widget.
