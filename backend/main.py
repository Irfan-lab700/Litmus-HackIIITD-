from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import JobRequest, JobResponse
import asyncio

from agents import run_litmus_agent

app = FastAPI(title="Litmus Backend Engine")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

cache_db = {}
history_db = []

@app.get("/")
def read_root():
    return {"message": "Backend server is running"}

@app.websocket("/ws/status")
async def websocket_status(websocket: WebSocket):
    await websocket.accept()
    steps = [
        "Initializing TinyFish headless browsers in parallel...",
        "Navigating to Public Search & MCA Portal...",
        "MCA Registry Check in progress...",
        "Scraping public headcount & velocity metrics...",
        "Running sentiment analysis on community/review threads...",
        "Compiling final 100-Point Reality Score..."
    ]
    try:
        for step in steps:
            await websocket.send_json({"message": step})
            await asyncio.sleep(1.2)
    except Exception as e:
        print(f"WS Closed: {e}")

@app.post("/api/submit-job", response_model=JobResponse)
async def submit_job(request: JobRequest):
    if request.job_url in cache_db:
        return cache_db[request.job_url]
    
    try:
        agent_data = await run_litmus_agent(request.company_name, request.job_url)
        
        result = JobResponse(
            company_name=request.company_name if request.company_name and request.company_name != "Auto-detected" else "Target Startup", 
            job_url=request.job_url,
            status="completed",
            raw_extraction=agent_data["raw_extraction"],
            reality_score=agent_data["reality_score"]
        )
        
        cache_db[request.job_url] = result
        history_db.insert(0, result)
        
        return result

    except Exception as e:
        print(f"Agent Execution Failed: {e}")
        raise HTTPException(status_code=500, detail="Litmus analysis failed.")

@app.get("/api/history", response_model=list[JobResponse])
async def get_history():
    return history_db[:10]