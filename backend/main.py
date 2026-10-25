import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents import DEMO, check_linkedin, check_mca, check_reddit, resolve_job, search_matching_entities
from scoring import build_report

app = FastAPI(title="Litmus")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Req(BaseModel):
    query: str  # company name, CIN, or job posting link


@app.post("/api/search-entities")
async def search_entities(req: Req):
    """Step 1: Returns matching entities if duplicate names exist so user can select one."""
    q = req.query.strip()
    if q.startswith(("http://", "https://")):
        # If it's a job link, resolve it directly
        job = await resolve_job(q)
        return {"type": "resolved", "company": job.get("company"), "domain": job.get("domain")}
    
    # Otherwise, return matching company entities from registries
    entities = await search_matching_entities(q)
    return {"type": "choices", "query": q, "entities": entities}


async def analyze(query: str, emit=None) -> dict:
    async def send(msg):
        if emit: await emit(msg)

    company = query.strip()
    await send({"type": "company", "company": company})

    async def step(name, fn):
        await send({"type": "status", "step": name, "state": "running"})
        try:
            res = await fn(company, lambda m: send({"type": "progress", "step": name, "message": m}))
            state = "done"
        except Exception as e:
            res, state = {"error": str(e)}, "error"
            await send({"type": "progress", "step": name, "message": str(e)[:200]})
        await send({"type": "status", "step": name, "state": state})
        return name, res

    raw = dict(await asyncio.gather(
        step("legal", check_mca),
        step("velocity", check_linkedin),
        step("sentiment", check_reddit)
    ))
    return build_report(company, raw)


@app.get("/api/health")
def health():
    return {"ok": True, "demo_mode": DEMO}


@app.websocket("/ws/analyze")
async def analyze_ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = await ws.receive_json()
            q = (msg.get("query") or "").strip()
            if not q:
                await ws.send_json({"type": "error", "message": "company name or CIN required"})
                continue
            try:
                report = await analyze(q, ws.send_json)
                await ws.send_json({"type": "result", "report": report})
            except Exception as e:
                await ws.send_json({"type": "error", "message": str(e)})
    except WebSocketDisconnect:
        pass