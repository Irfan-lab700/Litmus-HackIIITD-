from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
app = FastAPI(title = "Litmus backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

#routes
@app.get("/")
def read_root():
    return {"message": "Backend server is running"}
@app.post("/api/submit-job")
def submit_job():
    return {"message": "Initial Job Link API ready"}
 