const API_URL = "http://localhost:8000/api";
let uavState = {
  status: "OFFLINE",
  lat: 0,
  lon: 0,
  alt: 0,
  alt_msl: 0,
  agl: 0,
  heading: 0,
  target: null,
};
let currentRoutePoints = [],
  pickMode = null,
  tempPointEntity = null;
let lastAnalysisId = "";
let activeRouteLine = null;
let existingRouteNames = [];
let savedGroundPos = null;
let activeManualTarget = null;
let arrowEntity = null;
let arrowStartPos = Cesium.Cartesian3.ZERO;
let arrowEndPos = Cesium.Cartesian3.ZERO;
let showArrow = false;
let tempRouteLine = null;
let routePointEntities = [];

// === QUẢN LÝ ĐIỂM CHÁY ===
let fireAlerts = []; // Danh sách các điểm cháy {id, lat, lon, time, boxCount, status, cesiumEntity, leafletMarker}
let fireAlertIdCounter = 0;
const map2D = L.map("leafletContainer").setView([12.39678, 108.96045], 15);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map2D);
const droneMarker2D = L.marker([12.39678, 108.96045]).addTo(map2D);

Cesium.Ion.defaultAccessToken =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjZTBhOWFkMy04NGI3LTQyZTgtOWZiMS1lNDI4MDk1MDYxNWMiLCJpZCI6MzUzNzIxLCJpYXQiOjE3NjM3NzYxNDl9.-A4Zh27f6Xd0Ogg8BinRKWeDXewIYudw3rvSGz1Mqco";
const viewer = new Cesium.Viewer("cesiumContainer", {
  terrain: Cesium.Terrain.fromWorldTerrain(),
  baseLayerPicker: false,
  timeline: false,
  animation: false,
  infoBox: false,
  selectionIndicator: false,
  navigationHelpButton: false,
  geocoder: false,
  homeButton: false,
});
viewer.scene.globe.depthTestAgainstTerrain = true;

let droneEntity = viewer.entities.add({
  id: "uav",
  position: Cesium.Cartesian3.fromDegrees(108.96045, 12.39678, 50),
  model: {
    uri: "https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumAir/Cesium_Air.glb",
    scale: 3.0,
  },
  orientation: new Cesium.VelocityOrientationProperty(
    new Cesium.SampledPositionProperty()
  ),
});

arrowEntity = viewer.entities.add({
  polyline: {
    positions: new Cesium.CallbackProperty(() => {
      if (showArrow && arrowStartPos && arrowEndPos) {
        return [arrowStartPos, arrowEndPos];
      }
      return [];
    }, false),
    width: 15,
    material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.RED),
  },
});

viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(108.96045, 12.39678, 1500),
  orientation: { heading: 0, pitch: -0.7, roll: 0 },
});

window.emergencyStop = async () => {
  if (confirm("DỪNG LẠI NGAY LẬP TỨC?")) {
    await fetch(`${API_URL}/drone/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    showArrow = false;
    activeManualTarget = null;
    showToast("🛑 Đã gửi lệnh dừng!", "#fd7e14");
  }
};

window.toggleManualMode = () => {
  const c = document.getElementById("manualFlightBox");
  const b = document.querySelector(".collapsible-btn");
  c.style.display = c.style.display === "block" ? "none" : "block";
  b.classList.toggle("active-collapse");
};
window.switchTab = (mode, btn) => {
  document
    .querySelectorAll(".menu-item")
    .forEach((el) => el.classList.remove("active"));
  btn.classList.add("active");
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(`tab-${mode}`).classList.add("active");
  const cp = document.getElementById("mainControlPanel");
  if (["3d", "2d"].includes(mode)) {
    cp.style.display = "block";
    if (mode === "2d") setTimeout(() => map2D.invalidateSize(), 100);
  } else cp.style.display = "none";
  if (mode === "routes") loadRoutesTable();
};
function showToast(text, bg) {
  const t = document.createElement("div");
  t.style.cssText = `position:fixed; bottom:20px; right:20px; background:${bg}; color:white; padding:15px; border-radius:5px; z-index:9999; box-shadow:0 0 10px black; font-weight:bold;`;
  t.innerText = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
function refreshLucideIcons() {
  if (window.lucide && window.lucide.createIcons) {
    window.lucide.createIcons();
  }
}

function addAIResultRow(data) {
  const container = document.getElementById("aiResultContainer");
  if (container.innerText.includes("Chưa có dữ liệu")) container.innerHTML = "";
  const baseUrl = "http://localhost:8000";
  const urlOriginal = `${baseUrl}/${data.original}`;
  const urlProcessed = `${baseUrl}/${data.processed}`;
  const boxCount =
    data.box_count !== undefined ? data.box_count : data.has_fire ? "?" : 0;
  const isFire = data.has_fire;
  const row = document.createElement("div");
  row.className = "gallery-row";
  row.innerHTML = `<div class="img-wrapper"><a href="${urlOriginal}" target="_blank"><img src="${urlOriginal}"></a><div class="img-tag">Original: ${
    data.time
  }</div></div><div class="img-wrapper"><a href="${urlProcessed}" target="_blank"><img src="${urlProcessed}"></a><div class="img-tag" style="background:rgba(0,0,0,0.8); color:#00eaff;">YOLO: ${boxCount} boxes</div></div><div class="status-col ${
    isFire ? "st-detect" : "st-ok"
  }"><div class="status-icon">${
    isFire ? "❗" : "✅"
  }</div><div class="status-text">${
    isFire ? `CẢNH BÁO (${boxCount})` : "OK (0)"
  }</div></div>`;
  container.prepend(row);
  showToast(
    isFire ? `PHÁT HIỆN ${boxCount} ĐIỂM CHÁY!` : "Không phát hiện gì.",
    isFire ? "#dc3545" : "#28a745"
  );

  // === THÊM ĐIỂM CHÁY LÊN BẢN ĐỒ NẾU PHÁT HIỆN ===
  if (isFire && uavState.lat && uavState.lon) {
    addFireAlertMarker(
      uavState.lat,
      uavState.lon,
      boxCount,
      data.time,
      urlProcessed
    );
  }
}

// === HÀM THÊM MARKER ĐIỂM CHÁY ===
function addFireAlertMarker(lat, lon, boxCount, time, imageUrl) {
  const alertId = ++fireAlertIdCounter;

  // Tạo Entity trên Cesium 3D
  const cesiumEntity = viewer.entities.add({
    id: `fire_alert_${alertId}`,
    position: Cesium.Cartesian3.fromDegrees(lon, lat, uavState.alt_msl + 20),
    billboard: {
      image:
        "data:image/svg+xml," +
        encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="11" fill="#dc3545" stroke="#fff" stroke-width="2"/>
                    <text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-weight="bold">🔥</text>
                </svg>
            `),
      scale: 1.0,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `🔥 #${alertId}`,
      font: "12pt sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.RED,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.TOP,
      pixelOffset: new Cesium.Cartesian2(0, 10),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: { alertId: alertId, status: "pending" },
  });

  // Tạo Icon tùy chỉnh cho Leaflet 2D
  const fireIcon = L.divIcon({
    className: "fire-marker",
    html: `<div class="fire-marker-inner" data-id="${alertId}">
                   <span class="fire-pulse"></span>
                   <span class="fire-icon">🔥</span>
                   <span class="fire-label">#${alertId}</span>
               </div>`,
    iconSize: [50, 50],
    iconAnchor: [25, 50],
  });

  // Tạo Marker trên Leaflet 2D với Popup
  const leafletMarker = L.marker([lat, lon], { icon: fireIcon }).addTo(map2D);

  const popupContent = `
        <div class="fire-popup">
            <h4>🔥 CẢNH BÁO CHÁY #${alertId}</h4>
            <p><b>Thời gian:</b> ${time}</p>
            <p><b>Vị trí:</b> [${lat.toFixed(5)}, ${lon.toFixed(5)}]</p>
            <p><b>Số điểm phát hiện:</b> ${boxCount}</p>
            <img src="${imageUrl}" style="width:100%; max-height:150px; object-fit:cover; border-radius:5px; margin:5px 0;">
            <div class="fire-popup-actions">
                <button class="btn-resolve" onclick="resolveFireAlert(${alertId})">✅ Đã xử lý</button>
                <button class="btn-fly-to" onclick="flyToFireAlert(${alertId})">🚁 Bay tới</button>
            </div>
        </div>
    `;
  leafletMarker.bindPopup(popupContent, { maxWidth: 300 });

  // Lưu vào danh sách
  const alertData = {
    id: alertId,
    lat: lat,
    lon: lon,
    alt: uavState.alt_msl,
    time: time,
    boxCount: boxCount,
    imageUrl: imageUrl,
    status: "pending", // pending | resolved
    cesiumEntity: cesiumEntity,
    leafletMarker: leafletMarker,
  };
  fireAlerts.push(alertData);

  // Cập nhật danh sách hiển thị
  updateFireAlertsList();

  console.log(`🔥 Đã thêm điểm cháy #${alertId} tại [${lat}, ${lon}]`);
}

// === XỬ LÝ CLICK TRÊN CESIUM ĐỂ HIỆN POPUP ===
viewer.screenSpaceEventHandler.setInputAction(function (click) {
  const pickedObject = viewer.scene.pick(click.position);
  if (
    Cesium.defined(pickedObject) &&
    pickedObject.id &&
    pickedObject.id.id &&
    pickedObject.id.id.startsWith("fire_alert_")
  ) {
    const alertId = pickedObject.id.properties.alertId.getValue();
    showFireAlertDialog(alertId);
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// === HIỂN THỊ DIALOG XÁC NHẬN XỬ LÝ ===
function showFireAlertDialog(alertId) {
  const alert = fireAlerts.find((a) => a.id === alertId);
  if (!alert) return;

  const statusText =
    alert.status === "resolved" ? "✅ ĐÃ XỬ LÝ" : "⚠️ CHƯA XỬ LÝ";
  const statusColor = alert.status === "resolved" ? "#28a745" : "#dc3545";

  // Tạo modal dialog
  const existingModal = document.getElementById("fireAlertModal");
  if (existingModal) existingModal.remove();

  const modal = document.createElement("div");
  modal.id = "fireAlertModal";
  modal.innerHTML = `
        <div class="fire-modal-overlay" onclick="closeFireAlertModal()">
            <div class="fire-modal-content" onclick="event.stopPropagation()">
                <div class="fire-modal-header" style="background:${statusColor}">
                    <h3>🔥 ĐIỂM CHÁY #${alertId}</h3>
                    <span class="fire-modal-close" onclick="closeFireAlertModal()">&times;</span>
                </div>
                <div class="fire-modal-body">
                    <img src="${
                      alert.imageUrl
                    }" style="width:100%; max-height:200px; object-fit:cover; border-radius:8px; margin-bottom:15px;">
                    <div class="fire-modal-info">
                        <p><i data-lucide="clock" style="width:16px;height:16px;"></i> <b>Thời gian:</b> ${
                          alert.time
                        }</p>
                        <p><i data-lucide="map-pin" style="width:16px;height:16px;"></i> <b>Tọa độ:</b> [${alert.lat.toFixed(
                          5
                        )}, ${alert.lon.toFixed(5)}]</p>
                        <p><i data-lucide="flame" style="width:16px;height:16px;"></i> <b>Số điểm phát hiện:</b> ${
                          alert.boxCount
                        }</p>
                        <p><i data-lucide="activity" style="width:16px;height:16px;"></i> <b>Trạng thái:</b> <span style="color:${statusColor}; font-weight:bold;">${statusText}</span></p>
                    </div>
                </div>
                <div class="fire-modal-footer">
                    ${
                      alert.status === "pending"
                        ? `
                        <button class="btn-green" onclick="resolveFireAlert(${alertId})"><i data-lucide="check-circle" class="btn-icon"></i> Xác nhận đã xử lý</button>
                    `
                        : `
                        <button class="btn-yellow" onclick="unresolveFireAlert(${alertId})"><i data-lucide="rotate-ccw" class="btn-icon"></i> Đánh dấu chưa xử lý</button>
                    `
                    }
                    <button class="btn-blue" onclick="flyToFireAlert(${alertId})"><i data-lucide="navigation" class="btn-icon"></i> Bay tới điểm này</button>
                    <button class="btn-red" onclick="removeFireAlert(${alertId})"><i data-lucide="trash-2" class="btn-icon"></i> Xóa cảnh báo</button>
                </div>
            </div>
        </div>
    `;
  document.body.appendChild(modal);
  refreshLucideIcons();
}

function closeFireAlertModal() {
  const modal = document.getElementById("fireAlertModal");
  if (modal) modal.remove();
}

// === XÁC NHẬN ĐÃ XỬ LÝ ĐIỂM CHÁY ===
window.resolveFireAlert = function (alertId) {
  const alert = fireAlerts.find((a) => a.id === alertId);
  if (!alert) return;

  alert.status = "resolved";

  // Cập nhật màu Cesium Entity
  if (alert.cesiumEntity) {
    alert.cesiumEntity.billboard.image =
      "data:image/svg+xml," +
      encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="11" fill="#28a745" stroke="#fff" stroke-width="2"/>
                <text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">✓</text>
            </svg>
        `);
    alert.cesiumEntity.label.text = `✅ #${alertId}`;
    alert.cesiumEntity.label.outlineColor = Cesium.Color.GREEN;
    alert.cesiumEntity.properties.status = "resolved";
  }

  // Cập nhật Leaflet Marker
  if (alert.leafletMarker) {
    const newIcon = L.divIcon({
      className: "fire-marker resolved",
      html: `<div class="fire-marker-inner resolved" data-id="${alertId}">
                       <span class="fire-icon">✅</span>
                       <span class="fire-label">#${alertId}</span>
                   </div>`,
      iconSize: [50, 50],
      iconAnchor: [25, 50],
    });
    alert.leafletMarker.setIcon(newIcon);
  }

  updateFireAlertsList();
  closeFireAlertModal();
  showToast(`✅ Điểm cháy #${alertId} đã được xử lý!`, "#28a745");
};

// === ĐÁNH DẤU CHƯA XỬ LÝ ===
window.unresolveFireAlert = function (alertId) {
  const alert = fireAlerts.find((a) => a.id === alertId);
  if (!alert) return;

  alert.status = "pending";

  // Cập nhật màu Cesium Entity
  if (alert.cesiumEntity) {
    alert.cesiumEntity.billboard.image =
      "data:image/svg+xml," +
      encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="11" fill="#dc3545" stroke="#fff" stroke-width="2"/>
                <text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-weight="bold">🔥</text>
            </svg>
        `);
    alert.cesiumEntity.label.text = `🔥 #${alertId}`;
    alert.cesiumEntity.label.outlineColor = Cesium.Color.RED;
    alert.cesiumEntity.properties.status = "pending";
  }

  // Cập nhật Leaflet Marker
  if (alert.leafletMarker) {
    const newIcon = L.divIcon({
      className: "fire-marker",
      html: `<div class="fire-marker-inner" data-id="${alertId}">
                       <span class="fire-pulse"></span>
                       <span class="fire-icon">🔥</span>
                       <span class="fire-label">#${alertId}</span>
                   </div>`,
      iconSize: [50, 50],
      iconAnchor: [25, 50],
    });
    alert.leafletMarker.setIcon(newIcon);
  }

  updateFireAlertsList();
  closeFireAlertModal();
  showToast(`⚠️ Điểm cháy #${alertId} đánh dấu chưa xử lý!`, "#fd7e14");
};

// === XÓA ĐIỂM CHÁY ===
window.removeFireAlert = function (alertId) {
  if (!confirm(`Xóa cảnh báo điểm cháy #${alertId}?`)) return;

  const alertIndex = fireAlerts.findIndex((a) => a.id === alertId);
  if (alertIndex === -1) return;

  const alert = fireAlerts[alertIndex];

  // Xóa từ Cesium
  if (alert.cesiumEntity) {
    viewer.entities.remove(alert.cesiumEntity);
  }

  // Xóa từ Leaflet
  if (alert.leafletMarker) {
    map2D.removeLayer(alert.leafletMarker);
  }

  fireAlerts.splice(alertIndex, 1);
  updateFireAlertsList();
  closeFireAlertModal();
  showToast(`🗑️ Đã xóa điểm cháy #${alertId}`, "#6c757d");
};

// === BAY TỚI ĐIỂM CHÁY ===
window.flyToFireAlert = async function (alertId) {
  const alert = fireAlerts.find((a) => a.id === alertId);
  if (!alert) return;

  closeFireAlertModal();

  // Chuyển sang tab 3D và bay camera tới vị trí
  switchTab("3d", document.querySelectorAll(".menu-item")[0]);

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      alert.lon,
      alert.lat,
      alert.alt + 200
    ),
    orientation: { heading: 0, pitch: -0.5, roll: 0 },
    duration: 2,
  });

  // Hỏi người dùng có muốn điều khiển drone bay tới không
  if (
    confirm(
      `Bay drone tới điểm cháy #${alertId}?\n[${alert.lat.toFixed(
        5
      )}, ${alert.lon.toFixed(5)}]`
    )
  ) {
    if (uavState.agl < 49.5) {
      return alert(
        `⚠️ Drone chưa đạt độ cao an toàn (${uavState.agl.toFixed(
          1
        )}m). Vui lòng cất cánh trước!`
      );
    }

    await fetch(`${API_URL}/drone/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "move_to",
        target_lat: alert.lat,
        target_lon: alert.lon,
        target_alt: uavState.alt_msl,
      }),
    });
    showToast(`🚁 Đang bay tới điểm cháy #${alertId}...`, "#007bff");
  }
};

// === CẬP NHẬT DANH SÁCH HIỂN THỊ ===
function updateFireAlertsList() {
  const container = document.getElementById("fireAlertsList");
  if (!container) return;

  if (fireAlerts.length === 0) {
    container.innerHTML =
      '<div style="text-align:center; color:#888; padding:10px;">Chưa có cảnh báo</div>';
    return;
  }

  const pendingCount = fireAlerts.filter((a) => a.status === "pending").length;
  const resolvedCount = fireAlerts.filter(
    (a) => a.status === "resolved"
  ).length;

  container.innerHTML = `
        <div style="font-size:11px; color:#aaa; margin-bottom:5px;">
            ⚠️ Chưa xử lý: <span style="color:#dc3545; font-weight:bold;">${pendingCount}</span> | 
            ✅ Đã xử lý: <span style="color:#28a745; font-weight:bold;">${resolvedCount}</span>
        </div>
        ${fireAlerts
          .slice()
          .reverse()
          .map(
            (a) => `
            <div class="fire-alert-item ${
              a.status
            }" onclick="showFireAlertDialog(${a.id})">
                <span class="fire-alert-icon">${
                  a.status === "pending" ? "🔥" : "✅"
                }</span>
                <div class="fire-alert-info">
                    <span class="fire-alert-title">#${a.id} - ${a.time}</span>
                    <span class="fire-alert-coords">[${a.lat.toFixed(
                      4
                    )}, ${a.lon.toFixed(4)}]</span>
                </div>
            </div>
        `
          )
          .join("")}
    `;
}

async function updateLoop() {
  try {
    const res = await fetch(`${API_URL}/drone/state`);
    const data = await res.json();
    uavState = data;

    const position = Cesium.Cartesian3.fromDegrees(
      data.lon,
      data.lat,
      data.alt_msl
    );
    if (droneEntity) {
      droneEntity.position = position;
      const headingRad = Cesium.Math.toRadians(data.heading - 90);
      const hpr = new Cesium.HeadingPitchRoll(headingRad, 0, 0);
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(
        position,
        hpr
      );
      droneEntity.orientation = orientation;
    }

    droneMarker2D.setLatLng([data.lat, data.lon]);
    document.getElementById("uavStatus").innerText = data.status;
    document.getElementById("uavAlt").innerText =
      data.alt_msl.toFixed(0) + " m";
    document.getElementById("uavAGL").innerText = data.agl.toFixed(0) + " m";
    document.getElementById("uavBatt").innerText =
      Math.round(data.battery) + "%";
    document.getElementById("uavHeading").innerText =
      Math.round(data.heading) + "°";

    if (
      data.target &&
      (data.status === "moving" || data.status === "taking_off")
    ) {
      arrowStartPos = position;
      if (activeManualTarget) {
        arrowEndPos = activeManualTarget;
      } else {
        arrowEndPos = Cesium.Cartesian3.fromDegrees(
          data.target.lon,
          data.target.lat,
          data.target.alt
        );
      }
      showArrow = true;
    } else {
      showArrow = false;
      if (data.status === "hover" || data.status === "idle") {
        activeManualTarget = null;
      }
    }

    if (data.last_analysis && data.last_analysis.id !== lastAnalysisId) {
      addAIResultRow(data.last_analysis);
      lastAnalysisId = data.last_analysis.id;
    }
  } catch (e) {}
}
setInterval(updateLoop, 200);

window.safeTakeoff = async () => {
  if (uavState.status !== "idle") return alert("Drone đang bận!");
  if (confirm(`Xác nhận Cất cánh?`)) {
    await sendCmd("takeoff");
    showToast("🛫 Đang cất cánh...", "#28a745");
  }
};

window.safeLand = async () => {
  if (confirm("Hạ cánh?")) {
    activeManualTarget = null;
    savedGroundPos = null;
    await sendCmd("land");
  }
};

window.safeReturnHome = async () => {
  if (confirm("Về nhà?")) {
    activeManualTarget = null;
    await fetch(`${API_URL}/drone/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "move_to",
        target_lat: 12.39678,
        target_lon: 108.96045,
        target_alt: uavState.alt_msl,
      }),
    });
  }
};

window.capturePhoto = async () => {
  await sendCmd("capture");
  showToast("📸 Đang gửi ảnh tới AI...", "#007bff");
};

window.syncAltInput = (val) => {
  let intVal = parseInt(val);
  if (isNaN(intVal)) return;
  document.getElementById("cmdAltSlider").value = intVal;
  document.getElementById("cmdAltInput").value = intVal;
  document.getElementById("targetAltDisplay").innerText = intVal + " m";
};

window.safeFlyTo = async () => {
  const lat = parseFloat(document.getElementById("cmdLat").value);
  const lon = parseFloat(document.getElementById("cmdLon").value);
  const inputAlt = parseFloat(document.getElementById("cmdAltInput").value);

  if (isNaN(lat) || isNaN(lon)) return alert("⚠️ Lỗi: Chưa chọn tọa độ đích!");
  if (isNaN(inputAlt) || inputAlt < 50)
    return alert("⚠️ Lỗi: Độ cao đặt phải >= 50m!");

  if (uavState.agl < 49.5) {
    return alert(
      `⚠️ AN TOÀN BAY:\nDrone chưa đạt độ cao an toàn (Hiện tại: ${uavState.agl.toFixed(
        1
      )}m).\nVui lòng Cất cánh lên ít nhất 50m trước khi thực hiện bay điểm lẻ!`
    );
  }

  if (!confirm(`BAY TỚI MỤC TIÊU?\n[${lat}, ${lon}] - Alt: ${inputAlt}m`))
    return;

  if (tempPointEntity && savedGroundPos) {
    const carto = Cesium.Cartographic.fromCartesian(savedGroundPos);
    let terrainHeight = carto.height;
    if (terrainHeight < 0) terrainHeight = 0;
    const newAlt = terrainHeight + inputAlt;
    activeManualTarget = Cesium.Cartesian3.fromDegrees(
      Cesium.Math.toDegrees(carto.longitude),
      Cesium.Math.toDegrees(carto.latitude),
      newAlt
    );
    tempPointEntity.position = activeManualTarget;
  } else {
    let terrainH = 0;
    const carto = Cesium.Cartographic.fromDegrees(lon, lat);
    const h = viewer.scene.globe.getHeight(carto);
    if (h !== undefined) terrainH = h;
    activeManualTarget = Cesium.Cartesian3.fromDegrees(
      lon,
      lat,
      terrainH + inputAlt
    );
  }

  const currentTerrainH = uavState.alt_msl - uavState.agl;
  const targetMsl = currentTerrainH + inputAlt;

  await fetch(`${API_URL}/drone/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "move_to",
      target_lat: lat,
      target_lon: lon,
      target_alt: targetMsl,
    }),
  });
  showToast("🚀 Đã gửi lệnh bay!", "#007bff");
};
async function sendCmd(act) {
  await fetch(`${API_URL}/drone/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: act }),
  });
}

async function loadRoutesTable() {
  try {
    const r = await (await fetch(`${API_URL}/routes`)).json();
    existingRouteNames = r.map((x) => x.name);

    document.getElementById("routeTableBody").innerHTML = r
      .map(
        (x) => `
            <tr>
                <td>${x.name}</td>
                <td>${x.waypoints.length} điểm</td>
                <td style="display: flex; gap: 5px;">
                    <button class="btn-blue" onclick='viewRoute(${JSON.stringify(
                      x
                    )})'><i data-lucide="eye" class="btn-icon"></i> Xem</button>
                    <button class="btn-green" onclick='runRoute(${JSON.stringify(
                      x
                    )})'><i data-lucide="play" class="btn-icon"></i> Bay</button> 
                    <button class="btn-red" onclick="delRoute('${
                      x.name
                    }')"><i data-lucide="trash" class="btn-icon"></i>Xóa</button>
                </td>
            </tr>
        `
      )
      .join("");
    refreshLucideIcons();
  } catch (e) {
    console.error(e);
  }
}
window.runRoute = async (r) => {
  if (confirm(`Chạy lộ trình: ${r.name}?`)) {
    drawRouteLine(r.waypoints);
    activeManualTarget = null;
    await fetch(`${API_URL}/drone/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "execute_route",
        mission_waypoints: r.waypoints,
      }),
    });
    switchTab("3d", document.querySelectorAll(".menu-item")[0]);
  }
};
window.delRoute = async (n) => {
  if (confirm("Xóa?")) {
    await fetch(`${API_URL}/routes/${n}`, { method: "DELETE" });
    loadRoutesTable();
  }
};
function drawRouteLine(waypoints) {
  if (activeRouteLine) viewer.entities.remove(activeRouteLine);
  clearRouteMarkers();

  waypoints.forEach((wp, i) => {
    addNumberedPoint(wp.lon, wp.lat, wp.alt, i + 1);
  });

  const positions = waypoints.map((wp) =>
    Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, wp.alt)
  );
  if (positions.length > 2) positions.push(positions[0]);

  activeRouteLine = viewer.entities.add({
    polyline: {
      positions: positions,
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.YELLOW,
        dashLength: 20.0,
      }),
      clampToGround: false,
    },
  });
}
function updateTempRouteVisual() {
  if (tempRouteLine) {
    viewer.entities.remove(tempRouteLine);
    tempRouteLine = null;
  }

  if (currentRoutePoints.length < 2) return;

  const positions = currentRoutePoints.map((p) =>
    Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt)
  );

  positions.push(positions[0]);

  tempRouteLine = viewer.entities.add({
    polyline: {
      positions: positions,
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.CYAN,
        dashLength: 16.0,
      }),
      clampToGround: false,
    },
  });
}
window.viewRoute = (r) => {
  drawRouteLine(r.waypoints);

  switchTab("3d", document.querySelectorAll(".menu-item")[0]);

  if (activeRouteLine) {
    viewer.flyTo(activeRouteLine, {
      offset: new Cesium.HeadingPitchRange(0, -0.5, 2000),
    });
  }

  showToast(`👁️ Đang hiển thị lộ trình: ${r.name}`, "#007bff");
};
window.startCreateRoute = () => {
  const nameInput = document.getElementById("newRouteName");
  const name = nameInput.value.trim();
  if (!name) {
    alert("⚠️ Nhập tên lộ trình!");
    return;
  }
  if (existingRouteNames.includes(name)) {
    alert("⚠️ Tên bị trùng!");
    return;
  }
  document.getElementById("mainControlPanel").style.display = "none";
  document.getElementById("picker-panel").style.display = "block";
  document.getElementById("editingRouteName").innerText = name;
  currentRoutePoints = [];
  document.getElementById("tempPointsList").innerHTML = "";
  if (tempRouteLine) {
    viewer.entities.remove(tempRouteLine);
    tempRouteLine = null;
  }
  if (activeRouteLine) {
    viewer.entities.remove(activeRouteLine);
    activeRouteLine = null;
  }
  clearRouteMarkers();
  switchTab("3d", document.querySelectorAll(".menu-item")[0]);
};
window.addPointToRoute = () => {
  const lat = document.getElementById("wpLat").value;
  if (lat) {
    const newPoint = {
      lat: parseFloat(lat),
      lon: parseFloat(document.getElementById("wpLon").value),
      alt: parseFloat(document.getElementById("wpAlt").value),
    };
    currentRoutePoints.push(newPoint);

    if (tempPointEntity) viewer.entities.remove(tempPointEntity);
    savedGroundPos = null;
    updateTempRouteVisual();

    clearRouteMarkers();
    currentRoutePoints.forEach((p, idx) =>
      addNumberedPoint(p.lon, p.lat, p.alt, idx + 1)
    );

    updatePointsList();
  }
};

window.removePointFromRoute = (index) => {
  currentRoutePoints.splice(index, 1);
  updateTempRouteVisual();
  clearRouteMarkers();
  currentRoutePoints.forEach((p, idx) =>
    addNumberedPoint(p.lon, p.lat, p.alt, idx + 1)
  );
  updatePointsList();
};

function updatePointsList() {
  document.getElementById("tempPointsList").innerHTML = currentRoutePoints
    .map(
      (p, i) =>
        `<div style="display:flex; justify-content:space-between; align-items:center; margin:5px 0; padding:5px; background:rgba(0,0,0,0.3); border-radius:3px;">
            <span>${i + 1}. [${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}] - ${
          p.alt
        }m</span>
            <button onclick="removePointFromRoute(${i})" style="color:white; border:none; cursor:pointer; font-size:12px; display:flex; gap:4px; background:transparent" >
                <i data-lucide="x" class="btn-icon"></i>
            </button>
        </div>`
    )
    .join("");
  refreshLucideIcons();
}
window.finishSaveRoute = async () => {
  if (currentRoutePoints.length < 2) {
    alert("Cần tối thiểu 2 điểm!");
    return;
  }
  drawRouteLine(currentRoutePoints);
  await fetch(`${API_URL}/routes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: document.getElementById("editingRouteName").innerText,
      waypoints: currentRoutePoints,
    }),
  });
  document.getElementById("newRouteName").value = "";
  cancelEditRoute();
  switchTab("routes", document.querySelectorAll(".menu-item")[2]);
};
window.cancelEditRoute = () => {
  document.getElementById("picker-panel").style.display = "none";
  document.getElementById("mainControlPanel").style.display = "block";
  if (pickMode) togglePick(pickMode);
  savedGroundPos = null;

  if (tempRouteLine) {
    viewer.entities.remove(tempRouteLine);
    tempRouteLine = null;
  }
  clearRouteMarkers();
};
window.togglePick = (m) => {
  pickMode = pickMode === m ? null : m;
  document.getElementById("cesiumContainer").style.cursor = pickMode
    ? "crosshair"
    : "default";
  if (m === "cmd")
    document.getElementById("btnPickCmd").innerText = pickMode
      ? "❌ Đang chọn..."
      : "🎯 Chọn điểm trên bản đồ";
};
function clearRouteMarkers() {
  routePointEntities.forEach((entity) => {
    viewer.entities.remove(entity);
  });
  routePointEntities = [];
}
function addNumberedPoint(lon, lat, alt, index) {
  const entity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
    point: {
      pixelSize: 10,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: String(index),
      font: "14pt monospace",
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      fillColor: Cesium.Color.CYAN,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -10),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  routePointEntities.push(entity);
}
new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((c) => {
  if (!pickMode) return;

  let p = viewer.scene.pickPosition(c.position);
  if (!p)
    p = viewer.camera.pickEllipsoid(c.position, viewer.scene.globe.ellipsoid);

  if (p) {
    savedGroundPos = p;

    const carto = Cesium.Cartographic.fromCartesian(p);
    const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(5);
    const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(5);

    if (tempPointEntity) viewer.entities.remove(tempPointEntity);

    let altOffset =
      pickMode === "route"
        ? parseFloat(document.getElementById("wpAlt").value)
        : parseFloat(document.getElementById("cmdAltInput").value);

    let terrainHeight = carto.height;
    if (terrainHeight < 0) terrainHeight = 0;

    const finalAlt = terrainHeight + altOffset;
    const finalPos = Cesium.Cartesian3.fromDegrees(
      parseFloat(lon),
      parseFloat(lat),
      finalAlt
    );

    tempPointEntity = viewer.entities.add({
      position: finalPos,
      point: {
        pixelSize: 15,
        color: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
      },
    });

    if (pickMode === "route") {
      document.getElementById("wpLat").value = lat;
      document.getElementById("wpLon").value = lon;
      document.getElementById("zVal").innerText = altOffset + " m (AGL)";
    } else {
      document.getElementById("cmdLat").value = lat;
      document.getElementById("cmdLon").value = lon;
      const panel = document.getElementById("manualFlightBox");
      if (panel.style.display !== "block") toggleManualMode();
    }
    togglePick(pickMode);
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

Cesium.KmlDataSource.load("Ban_do_FINAL_OK_1.kmz", { clampToGround: true })
  .then((ds) => {
    viewer.dataSources.add(ds);
    window.kmzLayer = ds;
  })
  .catch(() => {});
document.getElementById("toggleKMZ").onchange = (e) => {
  if (window.kmzLayer) window.kmzLayer.show = e.target.checked;
};

proj4.defs(
  "VN2000_KH",
  "+proj=tmerc +lat_0=0 +lon_0=108.25 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"
);

const ringsVN2000 = [
  [576074.16, 1371221.19],
  [575999.76, 1371335.49],
  [576146.38, 1371553.51],
  [576125.35, 1371622.9],
  [576312.82, 1371774.28],
  [576377.5, 1371905.2],
  [576512.06, 1371897.13],
  [576607.3, 1371957.7],
  [576797.67, 1371825.78],
  [576872.38, 1371949.41],
  [576950.18, 1371997.7],
  [576975.86, 1371909.37],
  [577140.45, 1371755.84],
  [577181.13, 1371657.33],
  [577080.26, 1371541.99],
  [577078.54, 1371422.69],
  [577151.27, 1371332.54],
  [577106.21, 1371238.39],
  [577002.85, 1371262.09],
  [576952.92, 1370955.9],
  [576836.61, 1370873.48],
  [576766.52, 1370804.43],
  [576728.56, 1370718.47],
  [576520.91, 1370493.95],
  [576332.13, 1370419.98],
  [576305.93, 1370508.88],
  [576192.49, 1370566.43],
  [576132.67, 1370699.36],
  [576055.24, 1370745.43],
  [576120.66, 1370756.03],
  [576114.98, 1370808.65],
  [576218.4, 1370847.36],
  [576272.87, 1370811.86],
  [576285.1, 1370820.43],
  [576262.65, 1370850.35],
  [576316.62, 1370954.91],
  [576322.6, 1371029.9],
  [576275.53, 1370997.61],
  [576240.24, 1370861.6],
  [576175.08, 1370910.1],
  [576145.17, 1370845.22],
  [576073.25, 1370851.44],
  [576080.53, 1370961.11],
  [576055.36, 1371108.35],
  [576099.62, 1371191.83],
  [576175.0, 1371169.0],
  [576225.0, 1371214.0],
  [576303.66, 1371176.31],
  [576324.93, 1371306.0],
  [576229.39, 1371335.63],
];

let polygonEntity = null;

function initPolygonLayer() {
  const dx = 0.0018;
  const dy = -0.001;

  const degreesArray = [];

  ringsVN2000.forEach((pt) => {
    const wgs84 = proj4("VN2000_KH", "WGS84", pt);
    const finalLon = wgs84[0] + dx;
    const finalLat = wgs84[1] + dy;
    degreesArray.push(finalLon, finalLat);
  });

  const borderDegrees = [...degreesArray, degreesArray[0], degreesArray[1]];

  polygonEntity = viewer.entities.add({
    id: "vn2000-polygon",
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(
        Cesium.Cartesian3.fromDegreesArray(degreesArray)
      ),
      material: new Cesium.Color(1.0, 0.0, 0.0, 0.4),
      classificationType: Cesium.ClassificationType.TERRAIN,
    },
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(borderDegrees),
      width: 2,
      material: Cesium.Color.WHITE,
      clampToGround: true,
    },
    show: false,
  });
}

initPolygonLayer();

document
  .getElementById("togglePolygon")
  .addEventListener("change", function (e) {
    if (polygonEntity) {
      polygonEntity.show = e.target.checked;
      if (e.target.checked) {
        viewer.flyTo(polygonEntity, {
          offset: new Cesium.HeadingPitchRange(0, -0.5, 2000),
        });
      }
    }
  });
