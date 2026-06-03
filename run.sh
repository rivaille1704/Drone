#!/bin/bash

# Script chạy nhanh dự án Fire Detection Drone
# Tự động chạy server.py, simulator.py và mở Index.html

echo "=================================="
echo "🚁 Fire Detection Drone System"
echo "=================================="

# Kiểm tra Python có sẵn không
if ! command -v python &> /dev/null && ! command -v python3 &> /dev/null
then
    echo "❌ Python chưa được cài đặt!"
    exit 1
fi

# Xác định lệnh Python
PYTHON_CMD="python"
if command -v python3 &> /dev/null
then
    PYTHON_CMD="python3"
fi

echo "✅ Sử dụng: $PYTHON_CMD"

# Cài đặt dependencies nếu cần
echo ""
echo "📦 Kiểm tra dependencies..."
$PYTHON_CMD -m pip install -q fastapi uvicorn pydantic ultralytics pillow opencv-python 2>/dev/null || true

# Tạo thư mục cần thiết
mkdir -p forest Fire_detect_by_AI

echo ""
echo "🚀 Khởi động hệ thống..."
echo ""

# Chạy server.py trong background
echo "▶️  Khởi động FastAPI Server (port 8000)..."
$PYTHON_CMD server.py &
SERVER_PID=$!
sleep 3

# Chạy simulator.py trong background  
echo "▶️  Khởi động Drone Simulator..."
$PYTHON_CMD simulator.py &
SIMULATOR_PID=$!
sleep 2

# Mở Index.html trong trình duyệt
echo "▶️  Mở giao diện web..."
INDEX_FILE="$(pwd)/Index.html"

# Mở browser tùy theo OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$INDEX_FILE" 2>/dev/null || sensible-browser "$INDEX_FILE" 2>/dev/null
elif [[ "$OSTYPE" == "darwin"* ]]; then
    open "$INDEX_FILE"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    start "$INDEX_FILE"
fi

echo ""
echo "=================================="
echo "✅ Hệ thống đã khởi động!"
echo "=================================="
echo ""
echo "📌 Server PID: $SERVER_PID"
echo "📌 Simulator PID: $SIMULATOR_PID"
echo "📌 Web Interface: file:///$INDEX_FILE"
echo "📌 API Server: http://localhost:8000"
echo ""
echo "⏹️  Nhấn Ctrl+C để dừng..."
echo ""

# Hàm cleanup khi thoát
cleanup() {
    echo ""
    echo "🛑 Đang dừng hệ thống..."
    kill $SERVER_PID 2>/dev/null
    kill $SIMULATOR_PID 2>/dev/null
    echo "✅ Đã dừng!"
    exit 0
}

# Bắt signal Ctrl+C
trap cleanup INT TERM

# Đợi các process chạy
wait
