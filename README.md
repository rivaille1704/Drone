# UAV Forest Fire Management System

A comprehensive 3D GIS web-based system designed to manage Unmanned Aerial Vehicle (UAV) flight paths and detect forest fires in real-time. 

## 🏗️ System Architecture & Modeling

- **Spatial Layer-based Design**: Organizes geographic and operational data into distinct layers (Terrain, Static Objects, Dynamic Objects, and Flight Paths) for structured and optimized 3D visualization.
- **Hybrid State Management**: Employs an asynchronous push-pull data flow using FastAPI, utilizing In-Memory (RAM) caching for ultra-low latency telemetry updates and SQLite for persistent event logging.
- **AI Processing Pipeline**: Integrates a seamless data flow from the UAV simulator to the server, passing images through the YOLOv8 Object Detection model for real-time fire and smoke recognition.

## 🚀 Achieved Results

- **Dual-Mode Visualization**: Successfully deployed a robust Client-Server architecture featuring both interactive 3D terrain mapping via CesiumJS and a lightweight 2D observation mode via Leaflet.
- **Comprehensive Flight Simulation**: Built a functional UAV physics simulator capable of calculating AGL (Above Ground Level), battery drain, and executing both manual (click-to-fly) and automated multi-waypoint patrol routes.
- **Closed-Loop Fire Alerting**: Implemented a fully automated system that instantly displays visual proofs with bounding boxes, pinpoints exact GPS coordinates, and triggers UI alerts upon detecting anomalies.

## 🛠️ Tech Stack

- **Frontend**: CesiumJS, Leaflet, HTML, JavaScript
- **Backend**: FastAPI (Python), SQLite
- **AI Model**: Ultralytics YOLOv8

## 👥 Contributors (Group 7)

- Le Hoang Viet
- Trinh Thi Phuong Quynh
- Doan Minh Tuan
- Nguyen Hieu Thien Tuong
