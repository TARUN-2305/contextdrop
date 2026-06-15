# ContextDrop — Share Documents that Answer Back

> **TinyURL for understanding.** Upload a document or scrape a URL once, and share a secure, zero-friction conversational Q&A link with anyone. 

ContextDrop transforms static documents (PDFs, TXT) and web links into interactive, conversational knowledge capsules. It is designed to solve the **sender's problem**: instead of fielding dozens of follow-up emails and calls after sharing a document, creators can share a single link that answers readers' questions instantly, with absolute precision, zero sign-up friction, and inline source grounding.

---

## 🚀 Product Concept & Architecture

Every document or web link uploaded to ContextDrop is stored as a **Capsule**. 
* **Zero-Friction Reader Access**: Readers do not need to sign up, download files, or create accounts. They click the link, and immediately get a clean, familiar, messaging-style chat interface.
* **100% Grounded AI**: The AI is strictly sandboxed to the document. It does not hallucinate answers from external knowledge. If a question is not covered in the document, the AI explicitly states: *"This document doesn't cover that."*
* **Verification and Traceability**: Inline, clickable page citations (e.g., `[Page 3, Excerpt]`) accompany every answer so readers can verify the source in seconds.

### 🎨 Local Architecture & Tech Stack

ContextDrop is designed to run locally using a combination of local database volumes, local embedding execution, and cloud/local LLM generation:

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
[ pgvector Database (Docker) ]          [ RAG Query Pipeline ]
  Stores chunks & embeddings             1. Embed user query via local Ollama
  (Docker used for DB/Redis volumes)     2. Cosine similarity search (pgvector)
                                         3. Inject chunks into RAG prompt
                                         4. Stream answer via Groq (fallback Ollama)
```

1. **Frontend**: React (TypeScript) + Vite running at `http://localhost:5173`. Styled with luxury dark-theme glassmorphism and supporting dynamic accent colors and logos.
2. **REST API Backend**: Django & Django REST Framework (DRF) running at `http://localhost:8000`. Handles ingestion pipelines, user auth, capsule CRUD, tag endpoints, and creator analytics.
3. **SSE Server**: Node.js & Express running at `http://localhost:4000`. Streams LLM responses to the client chunk-by-chunk using Server-Sent Events (SSE).
4. **Vector Database**: PostgreSQL with the `pgvector` extension running inside a **local Docker container** (used strictly to host persistent volumes for Postgres and Redis).
   > [!WARNING]
   > **Vector Dimensions Constraint**: Once the database column `embedding` is created with a specific size (e.g. `dimensions=768` for Nomic), it cannot be altered to a different size (e.g. `1536` for OpenAI) without dropping and recreating the column or table. Changing embedding providers will require database migration steps (dropping/recreating the chunk tables).

5. **Embedding Engine**: Local **Ollama** running `nomic-embed-text` (768 dimensions) to embed document chunks and user queries.
6. **LLM Generation**: **Groq Cloud API** (`llama-3.3-70b-versatile`) acts as the primary chat engine, falling back to local **Ollama** (`gemma4:e2b`) if offline or Groq is unreachable.

---

## ⚡ Feature Guide

### 1. Document Upload & Drop Zone
* **Drag-and-Drop Ingestion**: Drop PDF or TXT files (up to 50MB) directly into the upload card.
* **Layout Parsing & Chunks**: Files are parsed, split into token chunks with a 20% overlap, embedded via local Ollama, and stored in the PostgreSQL database.

### 2. Web Link Scraper / Ingest
* **Web Scraping**: Paste any web article URL (e.g. blog post or wiki page). The backend scrapes raw HTML, cleans up scripts, extracts text content, and indexes it.

### 3. Capsule Title (Custom Naming)
* **Custom Names**: Set a custom name for capsules before ingestion, allowing you to organize and search them in your global dashboard.

### 4. Link Expiration (TTL Control)
* **TTL Controls**: Set capsules to expire after **24 Hours**, **7 Days**, or **30 Days**. Expired capsules and their chunks are automatically deleted.

### 5. White-Labeling & Custom Branding
* **Custom Logos**: Provide a URL for a custom logo dynamically loaded in the reader's chat header.
* **Accent Color Selector**: Choose a HEX color or pick one from the color picker to dynamically restyle the entire page (buttons, tags, and highlights) to match your custom brand.

### 6. Security (Password Lock)
* **Access Control**: Secure capsules with a password. Readers must input the correct password to unlock and chat with the document.

### 7. Automated Domain Classification
* **Domain Classifier**: On ingestion, the backend classifies the document into a domain (e.g., **Academic**, **Legal**, **Medical**, **Technical**, **Business**, or **General**) to adjust the AI's vocabulary and tone.

### 8. Interactive Chat & Citation Chips
* **Suggested Starter Questions**: Dynamic suggested prompts appear on initial chat load.
* **Streaming SSE Chat**: Streams tokens word-by-word with zero delay.
* **Tappable Citation Chips**: Real citations (like `[Page 4, Section 2.1]`) are parsed and rendered as clickable tags in the `IBM Plex Mono` font.
* **Voice Input (Web Speech API)**: Click the microphone icon to dictate questions hands-free.

### 9. Embed Widget (Iframe)
* **Embed Mode**: Append `?embed=true` to any capsule URL to load the widget mode, hiding headers and nav links for embedding in other blogs or documentation portals.

### 10. Deep Analytics Dashboard
* **Metrics Cards**: Logs *Total Questions*, *Answered Queries*, and *Unanswered Queries (Gaps)*.
* **Query Heatmap**: Bar chart indicating which document pages are queried most frequently.
* **Reader Gaps Log**: Exact log of questions readers asked that the AI couldn't answer, exposing content gaps in your source document.

### 11. Creator Workspace (Global Dashboard)
* **Multi-Capsule Manager**: Persists your created capsules under your user account.
* **Tag Management**: Add custom tags (`#tags`) and remove tags dynamically using the `×` button.

---

## 🛠️ Local Setup & Development Guide

Follow these steps to run the complete stack locally on your machine.

### Prerequisites
* Python 3.10+
* Node.js 18+
* Docker Desktop (running)
* Ollama installed and running (`ollama serve`)

---

### Step 1: Start Docker Volumes (DB & Redis)
In the root directory of the project, start PostgreSQL and Redis:
```bash
docker-compose up -d
```
Verify the containers are running:
```bash
docker ps
```
*(Should list `contextdrop-db-1` on port 5432 and `contextdrop-redis-1` on port 6379).*

---

### Step 2: Setup Ollama Local Models
Open a terminal and download the local embedding and fallback chat models:
```bash
# Pull the 768-dimension embedding model
ollama pull nomic-embed-text

# Pull the fallback chat model
ollama pull gemma4:e2b
```

---

### Step 3: Run Django Backend REST API
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # macOS/Linux:
   source .venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   python -m pip install -r requirements.txt
   ```
4. Copy the environment configuration template to create `.env`:
   ```bash
   cp .env.example .env
   ```
   Open `backend/.env` in your editor and configure your variables (e.g. fill in your `GROQ_API_KEY` from https://console.groq.com/). See [backend/.env.example](file:///C:/Users/tarun/Desktop/USEFUL/Projects/ContextDrop%20-%20copy/ContextDrop/backend/.env.example) for details on each key.
5. Run migrations:
   ```bash
   python manage.py makemigrations
   python manage.py migrate
   ```
6. Start the API server:
   ```bash
   python manage.py runserver
   ```
   *Available at `http://localhost:8000`.*

---

### Step 4: Run Node.js SSE Streaming Server
1. Navigate to the SSE server directory:
   ```bash
   cd sse-server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   node index.js
   ```
   *Available at `http://localhost:4000`.*

---

### Step 5: Run React Frontend Client
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment configuration template to create `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Open `frontend/.env.local` in your editor and adjust service ports if you are running services on custom local addresses. See [frontend/.env.example](file:///C:/Users/tarun/Desktop/USEFUL/Projects/ContextDrop%20-%20copy/ContextDrop/frontend/.env.example) for details.
4. Start the Vite server:
   ```bash
   npm run dev
   ```
   *Open `http://localhost:5173` in your browser.*

---

## 🧹 Wiping the System Clean (Fresh Start)

If you want to clear all data and start with a fresh slate (deleting all created capsules, user accounts, analytics, and stored media files):

1. **Flush Database Records**:
   Run the Django clean flush command inside the `backend` virtual environment:
   ```bash
   python manage.py flush --no-input
   ```
2. **Clear Uploaded Documents**:
   Remove all document files from media storage (run from project root):
   * **Windows (PowerShell)**:
     ```powershell
     Remove-Item -Path "backend/media/capsules/*" -Force -Recurse -ErrorAction SilentlyContinue
     ```
   * **macOS/Linux**:
     ```bash
     rm -rf backend/media/capsules/*
     ```
3. **Reset Redis Cache & Rates**:
   Wipe the local Redis cache database (run from project root):
   ```bash
   docker exec contextdrop-redis-1 redis-cli flushall
   ```

---

## 🔗 Widget Embedding Example
A test index file showing how to embed a capsule widget is located in `embed_test/index.html`. You can run a quick server inside the `embed_test` folder to view it:
```bash
cd embed_test
python -m http.server 8080
```
Then visit `http://localhost:8080` in your web browser.
