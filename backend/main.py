import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents import DEMO, check_linkedin, check_mca, check_reddit, resolve_job
from scoring import build_report

app = FastAPI(title="Litmus")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Req(BaseModel):
    query: str  # company name OR job posting link


async def analyze(query: str, emit=None) -> dict:
    async def send(msg):
        if emit: await emit(msg)

    company = query.strip()
    if company.lower().startswith(("http://", "https://")):  # step 1: "Submit Job Link"
        await send({"type": "status", "step": "resolve", "state": "running"})
        try:
            job = await resolve_job(company, lambda m: send({"type": "progress", "step": "resolve", "message": m}))
            company = job.get("company") or company
            await send({"type": "status", "step": "resolve", "state": "done"})
        except Exception as e:
            await send({"type": "status", "step": "resolve", "state": "error"})
            raise RuntimeError(f"Could not read the job link: {e}")
    await send({"type": "company", "company": company})

    async def step(name, fn):
        await send({"type": "status", "step": name, "state": "running"})
        try:
            res = await fn(company, lambda m: send({"type": "progress", "step": name, "message": m}))
            state = "done"
        except Exception as e:  # one failing agent must not kill the whole report
            res, state = {"error": str(e)}, "error"
            await send({"type": "progress", "step": name, "message": str(e)[:200]})
        await send({"type": "status", "step": name, "state": state})
        return name, res

    # step 3: trigger the three async TinyFish agents in parallel
    raw = dict(await asyncio.gather(step("legal", check_mca), step("velocity", check_linkedin),
                                    step("sentiment", check_reddit)))
    return build_report(company, raw)


@app.get("/api/health")
def health():
    return {"ok": True, "demo_mode": DEMO}


@app.post("/api/analyze")
async def analyze_rest(req: Req):
    return await analyze(req.query)


@app.websocket("/ws/analyze")
async def analyze_ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = await ws.receive_json()
            q = (msg.get("query") or "").strip()
            if not q:
                await ws.send_json({"type": "error", "message": "company name or job link required"}); continue
            try:
                report = await analyze(q, ws.send_json)
                await ws.send_json({"type": "result", "report": report})
            except Exception as e:
                await ws.send_json({"type": "error", "message": str(e)})
    except WebSocketDisconnect:
        pass