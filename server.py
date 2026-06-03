import sqlite3
import json
import os
import uuid 
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from ultralytics import YOLO 

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not os.path.exists("forest"):
    os.makedirs("forest")
app.mount("/forest", StaticFiles(directory="forest"), name="forest")

DETECT_FOLDER = "Fire_detect_by_AI"
if not os.path.exists(DETECT_FOLDER):
    os.makedirs(DETECT_FOLDER)

app.mount(f"/{DETECT_FOLDER}", StaticFiles(directory=DETECT_FOLDER), name="detected")
DB_FILE = "drone_db.sqlite"

try:
    model = YOLO("best.pt") 
except:
    model = None

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS uavs (
                    uav_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    model TEXT,
                    battery_capacity REAL,
                    status TEXT DEFAULT 'Active'
                )''')

    c.execute("SELECT count(*) FROM uavs")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO uavs (name, model, battery_capacity) VALUES (?, ?, ?)", 
                  ("FireBird-01", "DJI Matrice 300", 10000))

    c.execute('''CREATE TABLE IF NOT EXISTS flight_paths (
                    path_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE,
                    created_at TEXT
                )''')

    c.execute('''CREATE TABLE IF NOT EXISTS waypoints (
                    waypoint_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path_id INTEGER,
                    order_index INTEGER,
                    lat REAL,
                    lon REAL,
                    alt REAL,
                    FOREIGN KEY(path_id) REFERENCES flight_paths(path_id) ON DELETE CASCADE
                )''')

    c.execute('''CREATE TABLE IF NOT EXISTS forest_zones (
                    zone_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT,
                    geometry_json TEXT,
                    risk_level INTEGER
                )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uav_id INTEGER,
                    type TEXT,
                    description TEXT,
                    timestamp TEXT,
                    lat REAL,
                    lon REAL,
                    image_path TEXT
                )''')

    c.execute("SELECT count(*) FROM forest_zones")
    if c.fetchone()[0] == 0:
        geo = json.dumps([[108.96055, 12.39688], [108.96155, 12.39688], [108.96155, 12.39588], [108.96055, 12.39588]])
        c.execute("INSERT INTO forest_zones (name, geometry_json, risk_level) VALUES (?, ?, ?)", ("Khu Vuc 1", geo, 3))
    
    conn.commit()
    conn.close()

init_db()

class WaypointModel(BaseModel):
    lat: float; lon: float; alt: float

class RouteModel(BaseModel):
    name: str 
    waypoints: List[WaypointModel]

class DroneUpdate(BaseModel):
    lat: float; lon: float; alt_msl: float; agl: float; terrain_height: float; status: str; battery: float
    heading: float 
    last_photo: Optional[str] = None 

class Command(BaseModel):
    action: str 
    target_lat: Optional[float] = None; target_lon: Optional[float] = None; target_alt: Optional[float] = None
    mission_waypoints: Optional[List[dict]] = None 

drone_state = {
    "lat": 12.39678, "lon": 108.96045, "alt_msl": 0, "agl": 0, "terrain_height": 0,
    "status": "idle", "battery": 100, "heading": 0.0,
    "command": None, "target": None, "mission": [],
    "last_analysis": None 
}
processed_cache = set()

@app.get("/api/drone/state")
async def get_state(): return drone_state

@app.post("/api/drone/update")
async def update_drone(state: DroneUpdate):
    global drone_state
    backup = {k: drone_state[k] for k in ["command", "mission", "target", "last_analysis"]}
    drone_state.update(state.dict())
    drone_state.update(backup) 

    if state.last_photo and model:
        photo_path = state.last_photo
        
        if photo_path not in processed_cache:
            try:
                results = model.predict(source=photo_path, conf=0.05, save=False)
                result = results[0]
                
                json_str = result.to_json()
                detections = json.loads(json_str)
                box_count = len(detections)
                
                filename = os.path.basename(photo_path)
                processed_path = f"{DETECT_FOLDER}/ai_{filename}" 
                result.save(filename=processed_path)
                
                if box_count > 0:
                    try:
                        conn = sqlite3.connect(DB_FILE)
                        c = conn.cursor()
                        c.execute('''INSERT INTO events (uav_id, type, description, timestamp, lat, lon, image_path)
                                     VALUES (?, ?, ?, ?, ?, ?, ?)''',
                                  (1, 'FireDetected', f'Phát hiện {box_count} đám cháy', 
                                   datetime.now().strftime("%Y-%m-%d %H:%M:%S"), 
                                   drone_state['lat'], drone_state['lon'], processed_path))
                        conn.commit()
                        conn.close()
                    except Exception:
                        pass

                drone_state["last_analysis"] = {
                    "id": str(uuid.uuid4()),
                    "original": photo_path,
                    "processed": processed_path, 
                    "has_fire": (box_count > 0),
                    "box_count": box_count, 
                    "time": datetime.now().strftime("%H:%M:%S")
                }
                
                processed_cache.add(photo_path)
                
            except Exception:
                pass

    if not state.last_photo and backup["last_analysis"]:
        drone_state["last_analysis"] = backup["last_analysis"]

    return {"msg": "OK"}

@app.post("/api/drone/command")
async def send_command(cmd: Command):
    global drone_state
    drone_state["command"] = cmd.action
    
    if cmd.action == "move_to":
        drone_state["target"] = {"lat": cmd.target_lat, "lon": cmd.target_lon, "alt": cmd.target_alt}
        drone_state["last_analysis"] = None 
        drone_state["mission"] = [] 
        
    elif cmd.action == "execute_route":
        drone_state["mission"] = cmd.mission_waypoints
        
    elif cmd.action == "stop":
        drone_state["mission"] = [] 
        drone_state["target"] = None
    
    elif cmd.action == "capture":
        if drone_state["last_analysis"]:
            last_path = drone_state["last_analysis"]["original"]
            if last_path in processed_cache:
                processed_cache.remove(last_path)
    return {"msg": "Sent"}

@app.get("/api/routes")
async def get_routes():
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    c.execute("SELECT path_id, name FROM flight_paths ORDER BY path_id DESC")
    path_rows = c.fetchall()
    routes = []
    for p_row in path_rows:
        pid, name = p_row
        c.execute("SELECT lat, lon, alt FROM waypoints WHERE path_id=? ORDER BY order_index ASC", (pid,))
        wps = [{"lat": r[0], "lon": r[1], "alt": r[2]} for r in c.fetchall()]
        routes.append({"name": name, "waypoints": wps})
    conn.close()
    return routes

@app.post("/api/routes")
async def save_route(r: RouteModel):
    if not r.name or r.name.strip() == "": raise HTTPException(400, "Tên trống!")
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    try:
        c.execute("INSERT INTO flight_paths (name, created_at) VALUES (?, ?)", (r.name, str(datetime.now())))
        path_id = c.lastrowid
        for idx, wp in enumerate(r.waypoints):
            c.execute("INSERT INTO waypoints (path_id, order_index, lat, lon, alt) VALUES (?, ?, ?, ?, ?)", (path_id, idx, wp.lat, wp.lon, wp.alt))
        conn.commit(); return {"msg": "Saved"}
    except: raise HTTPException(400, "Lỗi lưu route")
    finally: conn.close()

@app.delete("/api/routes/{name}")
async def delete_route(name: str):
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    c.execute("SELECT path_id FROM flight_paths WHERE name=?", (name,))
    row = c.fetchone()
    if row:
        c.execute("DELETE FROM waypoints WHERE path_id=?", (row[0],))
        c.execute("DELETE FROM flight_paths WHERE path_id=?", (row[0],))
        conn.commit(); conn.close(); return {"msg": "Deleted"}
    conn.close(); raise HTTPException(404, "Not found")

@app.get("/api/forest-zones")
async def get_zones():
    conn = sqlite3.connect(DB_FILE); c = conn.cursor()
    z = [{"id": r[0], "name": r[1], "geometry": json.loads(r[2]), "risk": r[3]} for r in c.execute("SELECT * FROM forest_zones").fetchall()]
    conn.close(); return z

if __name__ == "__main__":
    import uvicorn
    print("🚀 Server started at: http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)