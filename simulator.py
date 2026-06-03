import asyncio
import requests
import math
import os
import random
import time

BASE_URL = "http://localhost:8000/api/drone"
HOME_POS = (12.39678, 108.96045)
CLIMB_RATE = 50
MOVE_SPEED = 0.001
IMAGE_FOLDER = "forest"

def get_terrain_height(lat, lon):
    base = 20
    variation = (109.0 - lon) * 1000
    return max(0, base + variation)

def get_photo_at_location(lat, lon, alt):
    if not os.path.exists(IMAGE_FOLDER):
        return None
    
    files = sorted([f for f in os.listdir(IMAGE_FOLDER) if f.lower().endswith(('.png', '.jpg', '.jpeg'))])
    
    if not files:
        return None
        
    seed_val = int((lat * 100000) + (lon * 100000) + (alt * 10))
    file_index = seed_val % len(files)
    selected_file = files[file_index]
    
    return os.path.join(IMAGE_FOLDER, selected_file)

start_h = get_terrain_height(HOME_POS[0], HOME_POS[1])
drone_phys = {
    "lat": HOME_POS[0],
    "lon": HOME_POS[1],
    "alt_msl": start_h + 0.0,
    "status": "idle",
    "battery": 100.0,
    "heading": 0.0
}

current_target = None
current_photo_path = None
current_mission = []
mission_index = 0

print("-" * 50)
print(f"🚀 SIMULATOR STARTED")
print(f"📍 Location: {HOME_POS}")
print("-" * 50)

async def drone_loop():
    global current_target, current_photo_path, current_mission, mission_index
    
    while True:
        try:
            terr_h = get_terrain_height(drone_phys["lat"], drone_phys["lon"])
            agl = drone_phys["alt_msl"] - terr_h
            
            if drone_phys["alt_msl"] < terr_h:
                drone_phys["alt_msl"] = terr_h

            if drone_phys["status"] != "idle":
                drone_phys["battery"] -= 0.01

            payload = {
                "lat": drone_phys["lat"], "lon": drone_phys["lon"],
                "alt_msl": drone_phys["alt_msl"], "agl": agl,
                "terrain_height": terr_h, "status": drone_phys["status"],
                "battery": drone_phys["battery"],
                "heading": drone_phys["heading"],
                "last_photo": current_photo_path
            }
            try:
                requests.post(f"{BASE_URL}/update", json=payload, timeout=0.2)
            except:
                print("⚠️ Connection lost (Retrying...)")

            try:
                res = requests.get(f"{BASE_URL}/state", timeout=0.2)
                server_data = res.json()
            except:
                await asyncio.sleep(1)
                continue

            cmd = server_data.get("command")
            target = server_data.get("target")
            mission_data = server_data.get("mission")
            
            if cmd == "takeoff":
                if drone_phys["status"] == "idle" or (drone_phys["status"] == "landing" and agl < 2):
                    print(f"✅ Takeoff! Target: {terr_h + 50}m")
                    drone_phys["status"] = "taking_off"
                    current_target = {"lat": drone_phys["lat"], "lon": drone_phys["lon"], "alt": terr_h + 50}
                    current_photo_path = None
            
            elif cmd == "land" and drone_phys["status"] != "landing":
                print(f"⬇️ Landing...")
                drone_phys["status"] = "landing"
                current_target = None
                current_photo_path = None
                current_mission = []

            elif cmd == "move_to" and target:
                t_lat = target["lat"] - drone_phys["lat"]
                t_lon = target["lon"] - drone_phys["lon"]
                dist_to_target = math.sqrt(t_lat**2 + t_lon**2)

                is_same_target = False
                if current_target:
                    if abs(target['lat'] - current_target['lat']) < 0.00001 and abs(target['lon'] - current_target['lon']) < 0.00001:
                        is_same_target = True
                
                if dist_to_target > 0.00001 or abs(target['alt'] - drone_phys['alt_msl']) > 0.5:
                    if not is_same_target or drone_phys["status"] == "hover":
                        print(f"✈️ Moving to: [{target['lat']:.5f}, {target['lon']:.5f}] - Alt: {target['alt']}m")
                        drone_phys["status"] = "moving"
                        current_target = target
                        current_photo_path = None
                        current_mission = []

            elif cmd == "execute_route" and mission_data:
                if drone_phys["status"] != "mission_executing":
                    print(f"🔄 Starting Mission ({len(mission_data)} waypoints)...")
                    current_mission = mission_data
                    mission_index = 0
                    wp = current_mission[0]
                    current_target = {"lat": wp["lat"], "lon": wp["lon"], "alt": wp["alt"]}
                    drone_phys["status"] = "mission_executing"
                    current_photo_path = None

            elif cmd == "stop":
                if drone_phys["status"] != "hover":
                    print("🛑 Emergency Stop!")
                    drone_phys["status"] = "hover"
                    current_target = {"lat": drone_phys["lat"], "lon": drone_phys["lon"], "alt": drone_phys["alt_msl"]}
                    current_mission = []

            elif cmd == "capture":
                if current_photo_path is None:
                    print(f"📸 Capturing photo...")
                    current_photo_path = get_photo_at_location(drone_phys["lat"], drone_phys["lon"], drone_phys["alt_msl"])
                    print(f"   ➤ File: {current_photo_path}")

            if drone_phys["status"] == "taking_off" and current_target:
                if drone_phys["alt_msl"] < current_target["alt"] - 0.5:
                    drone_phys["alt_msl"] += CLIMB_RATE * 0.05
                else:
                    drone_phys["status"] = "hover"
                    print("✅ Takeoff Complete. Hovering.")

            elif drone_phys["status"] == "landing":
                if drone_phys["alt_msl"] > terr_h + 0.2:
                    drone_phys["alt_msl"] -= CLIMB_RATE * 0.05
                else:
                    drone_phys["status"] = "idle"
                    drone_phys["alt_msl"] = terr_h
                    print("✅ Landed Safely.")

            elif drone_phys["status"] in ["moving", "mission_executing"] and current_target:
                d_lat = current_target["lat"] - drone_phys["lat"]
                d_lon = current_target["lon"] - drone_phys["lon"]
                d_alt = current_target["alt"] - drone_phys["alt_msl"]
                
                dist_horiz = math.sqrt(d_lat**2 + d_lon**2)
                dist_vert = abs(d_alt)

                climb_step_per_tick = CLIMB_RATE * 0.05
                steps_horiz = dist_horiz / MOVE_SPEED if MOVE_SPEED > 0 else 0
                steps_vert = dist_vert / climb_step_per_tick if climb_step_per_tick > 0 else 0

                total_steps = max(steps_horiz, steps_vert)

                if total_steps > 1:
                    step_ratio = 1 / total_steps
                    drone_phys["lat"] += d_lat * step_ratio
                    drone_phys["lon"] += d_lon * step_ratio
                    drone_phys["alt_msl"] += d_alt * step_ratio
                    
                    if dist_horiz > MOVE_SPEED / 10:
                        angle = math.degrees(math.atan2(d_lat, d_lon))
                        drone_phys["heading"] = 90 - angle

                else:
                    drone_phys["lat"] = current_target["lat"]
                    drone_phys["lon"] = current_target["lon"]
                    drone_phys["alt_msl"] = current_target["alt"]
                    
                    if drone_phys["status"] == "moving":
                        drone_phys["status"] = "hover"
                        print(f"✅ Arrived! Alt: {drone_phys['alt_msl']:.1f}m")
                        
                    elif drone_phys["status"] == "mission_executing":
                        print(f" 🚩 Passed WP {mission_index + 1}. Alt: {drone_phys['alt_msl']:.1f}m")
                        mission_index += 1
                        if mission_index >= len(current_mission):
                            mission_index = 0
                            print(" 🔄 Mission Loop Complete. Restarting...")
                        
                        next_wp = current_mission[mission_index]
                        current_target = {"lat": next_wp["lat"], "lon": next_wp["lon"], "alt": next_wp["alt"]}

            await asyncio.sleep(0.05)

        except Exception as e:
            print(f"Error: {e}")
            await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(drone_loop())