# WhyDidItFail

A real-time failure monitoring and diagnosis tool for Prusa MK3 / MK3+. Streams live printer data over USB serial, automatically detects firmware errors, and triggers AI-powered diagnosis. Users can also manually report issues mid-print — selecting the failure type, filling in print context, and optionally uploading a photo for visual analysis by Claude's vision model alongside the serial logs.

## Features

- **Live serial monitor** — streams real-time data from your printer over USB at 115200 baud
- **Automatic failure detection** — captures a 2-minute data snapshot when `Error:` or `PROBE_FAIL` is detected
- **AI diagnosis** — LangChain agent + RAG over a Supabase pgvector knowledge base gives targeted fix steps
- **Visual diagnosis** — upload a photo of the print and Claude's vision model analyzes it directly
- **Manual issue reporting** — report warping, stringing, layer shifts, clogs and more mid-print with contextual info (material, layer, room temp)
- **Streaming diagnosis UI** — real-time status updates as the agent reasons through the problem
- **General chat assistant** — ask anything about your Prusa MK3S+ with live printer context
- **Auto-reconnect** — server reconnects to the printer automatically within 5 seconds of USB plug-in
- **Auto-start on login** — runs as a macOS launchd service, no terminal needed

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router, TypeScript strict |
| AI | LangChain.js — `createReactAgent`, `RunnableSequence` |
| Model | Claude Haiku 4.5 via `@langchain/anthropic` |
| Embeddings | `text-embedding-3-small` via `@langchain/openai` |
| Vector DB | Supabase pgvector (`match_print_knowledge` RPC) |
| Serial | `serialport` npm package with `ReadlineParser` |
| Streaming | SSE (`text/event-stream`) for live serial + diagnosis |
| Styling | Custom CSS design system (`wd-` component classes) |

## Project Structure

```
src/
  app/
    page.tsx                      # Live monitor dashboard
    history/page.tsx              # Failure snapshot history
    api/
      serial/route.ts             # SSE: streams line / frame / failure events
      diagnose/route.ts           # POST: SSE diagnosis stream
      chat/route.ts               # POST: failure-specific chat
      chat/general/route.ts       # POST: general printer assistant
      failures/route.ts           # GET: list saved snapshots
      manual-snapshot/route.ts    # POST: trigger manual snapshot + photo upload
  components/
    SerialMonitor.tsx             # Color-coded live terminal
    PrinterStatus.tsx             # Temp gauges, progress, time remaining
    FailureCard.tsx               # Diagnosis result card with export + chat
    FailureChat.tsx               # Follow-up chat scoped to a failure
    GeneralChat.tsx               # General printer assistant chat
  lib/
    serial.ts                     # SerialManager singleton with auto-retry
    real-serial.ts                # Hardware serial via serialport
    mock-serial.ts                # Mock emulator for dev without printer
    parser.ts                     # Line parser: temps, progress, noise filter
    langchain.ts                  # Diagnosis chain + vision support
    vectorstore.ts                # Supabase pgvector retriever
    snapshots.ts                  # Read/write failure snapshots to disk
  data/failures/                  # JSON snapshots (auto-created)
  types/index.ts
public/
  snapshots/                      # Uploaded print photos (auto-created)
  CabinetGrotesk-Black.ttf        # Brand font
```

## Setup

**1. Clone and install**

```bash
git clone <repo-url>
cd whydiditfail
npm install
```

**2. Add environment variables**

Create `.env.local` in the project root:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SERIAL_PORT=/dev/tty.usbmodem101
SERIAL_BAUD=115200
```

Omit `SERIAL_PORT` to run in mock mode (simulated printer data, useful for development without hardware).

**3. Run**

```bash
npm run dev       # development
npm run build && npm start   # production
```

Open [http://localhost:3000](http://localhost:3000).

## Auto-start on macOS

To run as a background service that starts on login and auto-reconnects when the printer is plugged in:

```bash
cp com.whydiditfail.server.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.whydiditfail.server.plist
```

Logs are written to `/tmp/whydiditfail.log`.

## Usage

1. **Plug in your printer** — the server connects automatically within 5 seconds
2. **Live Monitor tab** — watch the serial stream, temperature gauges, and time remaining in real time
3. **Report Issue** — if you spot a visual problem (warping, stringing, etc.), click **Report Issue**, select the type, add context (material, layer, room temp), optionally upload a photo, then run diagnosis
4. **Automatic detection** — firmware errors trigger a snapshot and diagnosis automatically
5. **History tab** — browse past failure snapshots and re-run diagnosis on any of them
6. **Assistant** — ask anything about your printer in the chat panel on the right

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for diagnosis, vision, and chat |
| `OPENAI_API_KEY` | Yes | OpenAI key for `text-embedding-3-small` embeddings |
| `SUPABASE_URL` | Yes | Supabase project URL for pgvector knowledge base |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `SERIAL_PORT` | No | USB serial port path — omit to use mock mode |
| `SERIAL_BAUD` | No | Baud rate, defaults to 115200 |

**Why two API keys?** The two keys serve different purposes. `ANTHROPIC_API_KEY` powers Claude Haiku for all language tasks — diagnosis reasoning, vision analysis, and chat. `OPENAI_API_KEY` is used solely for generating vector embeddings (`text-embedding-3-small`) to search the print knowledge base in Supabase. Anthropic does not currently offer an embeddings API, so OpenAI handles that one step. Embedding costs are minimal (fractions of a cent per query).
