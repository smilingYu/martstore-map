let map;
// 修改這裡：加入設定參數
let markers = L.markerClusterGroup({
    disableClusteringAtZoom: 14, // 【關鍵設定】0 (全球) 到 18 (街道細節)，當縮放層級達到 16 (或更深) 時，強制取消叢集，直接顯示個別店家，15 會更早散開（地圖範圍較大時就散開），17 則需要拉得更近才會散開。
    spiderfyOnMaxZoom: true,     // 保持預設：如果多個店家座標完全重疊，點擊後會呈蜘蛛網狀散開
    maxClusterRadius: 50         // (選用) 縮小叢集的半徑 (預設80)，讓標記比較容易被獨立分出來
});
let nonClusteredMarkers = L.layerGroup();
let isMarkerClusterEnabled = true;
let locateControl;
let stores = [];
let deferredPrompt;
let searchMarkers = {};

// LocalStorage
const STORAGE_KEY = 'storeMapState';
let lastSavedState = '';
let saveTimeout;

function debounceSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveStateToStorage, 300);
}

function initMap() {
    map = L.map('map', { zoomControl: false, maxBoundsViscosity: 1.0 }).setView([23.5, 121], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.setMaxBounds([[20, 118], [26, 124]]);
    map.addLayer(markers);

    locateControl = L.control.locate({
        position: 'topright',
        drawCircle: true,
        drawMarker: true,
        setView: 'once',
        keepCurrentZoomLevel: false,
        circleStyle: { color: '#3388ff', fillColor: '#3388ff', fillOpacity: 0.2, weight: 2, opacity: 1 },
        markerStyle: { fillColor: '#2A93EE', fillOpacity: 1, color: '#fff', weight: 3 },
        showPopup: true,
        strings: { title: "顯示我的位置", popup: "您的位置" },
        locateOptions: { enableHighAccuracy: true },
        onLocationError: function(err) { console.error("無法獲取您的位置：" + err.message); }
    }).addTo(map);

    map.on('moveend zoomend', debounceSave);
    loadStores();
    locateControl.start();
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('desktopShortcutBtn');
    if (btn) btn.style.display = 'block';
});

// 假設 stores 是一個全域變數，用來儲存所有店家的資料
// var stores = []; 

async function loadStores() {
    try {
        // 1. 同時發起兩個檔案的請求
        const [coordinatesResponse, milkResponse] = await Promise.all([
            fetch('store_coordinates.json'),
            fetch('store_milk.json') // 新增載入 store_milk.json
        ]);

        // 2. 檢查兩個請求是否都成功
        if (!coordinatesResponse.ok) throw new Error('無法載入主要店家座標資料 (store_coordinates.json)');
        if (!milkResponse.ok) throw new Error('無法載入奶粉店家資料 (store_milk.json)');

        // 3. 解析 JSON 資料
        const coordinatesData = await coordinatesResponse.json();
        const milkData = await milkResponse.json();

        // 4. 合併資料
        // 假設兩個 JSON 檔案都是陣列 (Array)，直接串接即可
        // 注意：請確保您的 JSON 檔案結構是相同的，這樣後續邏輯才能正確運作。
        stores = coordinatesData.concat(milkData);

        // 5. 執行初始化和渲染
        populateCounties();
        populateMultiFilterAccordion();
        displayStores(stores); // 使用合併後的資料
        initializeSearch();

        loadStateFromStorage(); 
    } catch (error) {
        console.error("載入店家資料失敗:", error);
        alert('載入店家資料失敗，請檢查網路連線或檔案路徑。');
    }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function initializeSearch() {
    const searchInput = document.getElementById('storeSearch');
    const searchResults = document.getElementById('searchResults');
    let debounceTimer;
    let currentQuery = '';
    let abortController = null;

    const performSearch = () => {
        const query = searchInput.value.trim().toLowerCase();
        currentQuery = query;
        searchResults.innerHTML = '';
        searchResults.style.display = 'none';
        if (query) {
            let filteredStores = stores.filter(store => store.name.toLowerCase().includes(query));
            if (filteredStores.length > 0) {
                if (abortController) abortController.abort();
                abortController = new AbortController();
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        if (currentQuery !== query) return;
                        const userLat = position.coords.latitude;
                        const userLon = position.coords.longitude;
                        const storesWithDistance = filteredStores
                            .map(store => ({ ...store, distance: calculateDistance(userLat, userLon, store.lat, store.lng) }))
                            .sort((a, b) => a.distance - b.distance)
                            .slice(0, 10);
                        renderSearchResults(storesWithDistance);
                    },
                    (error) => {
                        if (currentQuery !== query) return;
                        const sortedStores = filteredStores.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10);
                        renderSearchResults(sortedStores);
                    },
                    { enableHighAccuracy: true, signal: abortController.signal }
                );
            }
        }
    };

    const renderSearchResults = (storesList) => {
        searchResults.style.display = 'block';
        searchResults.innerHTML = '';
        storesList.forEach(store => {
            const item = document.createElement('div');
            item.className = 'list-group-item';
            item.innerHTML = store.distance !== undefined
                ? `${store.name}<span class="distance">(${store.distance.toFixed(2)} 公里)</span>`
                : store.name;
            item.setAttribute('aria-label', `選擇店家 ${store.name}`);
            item.addEventListener('click', () => {
                focusOnStore(store);
                searchResults.innerHTML = '';
                searchResults.style.display = 'none';
                searchInput.value = '';
            });
            searchResults.appendChild(item);
        });
    };

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(performSearch, 200);
    });
}

function focusOnStore(store) {
    if (store.lat && store.lng) {
        const marker = searchMarkers[store.name];
        if (marker) {
            map.setView([store.lat, store.lng], 15);
            marker.openPopup();
        } else {
            displayStores([store]);
            map.setView([store.lat, store.lng], 15);
            const newMarker = (isMarkerClusterEnabled ? markers : nonClusteredMarkers).getLayers().find(m =>
                m.getLatLng().lat === store.lat && m.getLatLng().lng === store.lng
            );
            if (newMarker) {
                newMarker.openPopup();
                searchMarkers[store.name] = newMarker;
            }
        }
    }
}

function clearSearch() {
    const searchInput = document.getElementById('storeSearch');
    const searchResults = document.getElementById('searchResults');
    searchInput.value = '';
    searchResults.innerHTML = '';
    searchResults.style.display = 'none';
    if (debounceTimer) clearTimeout(debounceTimer);
    if (abortController) abortController.abort();
    displayStores(getCurrentFilteredStores());
}

function populateCounties() {
    const countySelect = document.getElementById('county');
    countySelect.innerHTML = '<option value="">選擇縣市</option>';
    const storeTypes = Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(i => i.value);
    let filteredStores = stores;
    if (storeTypes.length > 0) filteredStores = stores.filter(s => storeTypes.includes(s.type.toLowerCase()));
    const counties = [...new Set(filteredStores.map(s => s.county))].sort();
    counties.forEach(county => {
        const option = document.createElement('option');
        option.value = county;
        option.textContent = county;
        countySelect.appendChild(option);
    });
}

function updateCounties() {
    populateCounties();
    updateDistricts();
    debounceSave();
}

function updateDistricts() {
    const countySelect = document.getElementById('county');
    const districtSelect = document.getElementById('district');
    districtSelect.innerHTML = '<option value="">選擇鄉鎮市區</option>';
    const storeTypes = Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(i => i.value);
    const selectedCounty = countySelect.value;
    if (selectedCounty) {
        let filteredStores = stores;
        if (storeTypes.length > 0) filteredStores = filteredStores.filter(s => storeTypes.includes(s.type.toLowerCase()));
        const districts = [...new Set(filteredStores.filter(s => s.county === selectedCounty).map(s => s.district))].sort();
        districts.forEach(district => {
            const option = document.createElement('option');
            option.value = district;
            option.textContent = district;
            districtSelect.appendChild(option);
        });
    }
    debounceSave();
}

function populateMultiFilterAccordion() {
    const accordionDiv = document.getElementById('multiFilterAccordion');
    const storeTypes = Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(i => i.value);
    let filteredStores = stores;
    if (storeTypes.length > 0) filteredStores = stores.filter(s => storeTypes.includes(s.type.toLowerCase()));
    const directions = [...new Set(filteredStores.map(s => s.direction))].sort();
    
    // 優化：使用陣列收集 HTML
    const htmlParts = [];
    let index = 0;
    
    for (const direction of directions) {
        const counties = [...new Set(filteredStores.filter(s => s.direction === direction).map(s => s.county))].sort();
        
        // 建構內部縣市 HTML
        const countiesHtml = counties.map(county => {
            const districts = [...new Set(filteredStores.filter(s => s.county === county).map(s => s.district))].sort();
            const storeCount = filteredStores.filter(s => s.county === county).length;
            
            const districtsHtml = districts.map(district => {
                const districtStoreCount = filteredStores.filter(s => s.county === county && s.district === district).length;
                return `<label><input type="checkbox" name="district-${county}" value="${district}" onchange="handleCheckboxChange(event)"> ${district} <span class="district-count">(${districtStoreCount})</span></label><br>`;
            }).join('');

            return `
                <div class="accordion-item">
                    <h2 class="accordion-header" id="headingCounty${index}-${counties.indexOf(county)}">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseCounty${index}-${counties.indexOf(county)}">
                            <span class="county-checkbox"><input type="checkbox" name="county" value="${county}" onchange="handleCheckboxChange(event)"> ${county}</span>
                            <span class="store-count">(${storeCount})</span>
                        </button>
                    </h2>
                    <div id="collapseCounty${index}-${counties.indexOf(county)}" class="accordion-collapse collapse">
                        <div class="accordion-body checkbox-group">
                            ${districtsHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 建構外部方向 HTML
        htmlParts.push(`
            <div class="accordion-item">
                <h2 class="accordion-header" id="headingDirection${index}">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseDirection${index}" aria-expanded="false">
                        ${direction}
                    </button>
                </h2>
                <div id="collapseDirection${index}" class="accordion-collapse collapse">
                    <div class="accordion-body">
                        ${countiesHtml}
                    </div>
                </div>
            </div>
        `);
        index++;
    }
    
    // 一次性寫入 DOM
    accordionDiv.innerHTML = htmlParts.join('');
}

function updateMultiFilterAccordion() {
    populateMultiFilterAccordion();
    debounceSave();
}

function handleCheckboxChange(event) {
    event.stopPropagation();
    const input = event.target;
    if (input.closest('.county-checkbox')) {
        const collapseId = input.closest('.accordion-header').getAttribute('data-bs-target');
        if (input.checked && collapseId) {
            const collapseEl = document.querySelector(collapseId);
            if (collapseEl) new bootstrap.Collapse(collapseEl, { toggle: false }).show();
        }
    }
    debounceSave();
}

function displayStores(storesToDisplay) {
    if (isMarkerClusterEnabled) {
        markers.clearLayers();
        map.removeLayer(nonClusteredMarkers);
        map.addLayer(markers);
    } else {
        nonClusteredMarkers.clearLayers();
        map.removeLayer(markers);
        map.addLayer(nonClusteredMarkers);
    }

    searchMarkers = {};

    storesToDisplay.forEach(store => {
        if (store.lat && store.lng) {
            const storeName = store.name.replace(/"/g, '&quot;');
            let logoSrc = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';
            switch (store.type.toLowerCase()) {
                case 'carrefour': case '家樂福': logoSrc = 'src/carrefour-logo.png'; break;
                case 'pxmart': case '全聯': logoSrc = 'src/pxmart-logo.png'; break;
                case 'rt-mart': case '大潤發': logoSrc = 'src/rtmart-logo.png'; break;
                case 'ssafe': case '大買家': logoSrc = 'src/ssafe-logo.png'; break;
                case 'a.mart': case '愛買': logoSrc = 'src/amart-logo.jpg'; break;
                case 'greattree': case '大樹': logoSrc = 'src/greattree-logo.jpg'; break;
                case 'littlechef': case '小當家': logoSrc = 'src/littlechef-logo.png'; break;
                case 'hongan': case '弘安': logoSrc = 'src/hongan-logo.png'; break;
                case 'chengguang': case '正光': logoSrc = 'src/chengguang-logo.jpg'; break;
                case 'global': case '全球': logoSrc = 'src/global-logo.jpg'; break;
                case 'mingyuan': case '名媛': logoSrc = 'src/mingyuan-logo.jpg'; break;
                case 'yierle': case '宜兒樂': logoSrc = 'src/yierle-logo.jpg'; break;
                case 'imei': case '易美': logoSrc = 'src/imei-logo.jpg'; break;
                case 'hipp': case '喜寶': logoSrc = 'src/hipp-logo.jpg'; break;
                case 'mamahow': case '媽媽好': logoSrc = 'src/mamahow-logo.jpg'; break;
                case 'naughty': case '頑皮寶貝': logoSrc = 'src/naughty-logo.jpg'; break;
                case 'leerwu': case '樂兒屋': logoSrc = 'src/leerwu-logo.png'; break;
                case 'love': case '樂芙': logoSrc = 'src/love-logo.jpg'; break;
                case 'poly': case '寶齡': logoSrc = 'src/poly-logo.jpg'; break;
            }

            // 在 displayStores 函式內找到 const icon = L.divIcon({ ... }) 的部分並替換
            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: `
                    <div style="text-align: center; line-height: 1.2; position: relative;">
                        <img src="${logoSrc}" style="width: 32px; height: 32px; display: block; margin: 0 auto;">
                        <div class="marker-label">
                            ${storeName}
                        </div>
                    </div>
                `,
                iconSize: [100, 60], // 稍微加大高度以容納標籤
                iconAnchor: [50, 50],
                popupAnchor: [0, -40]
            });

            const marker = L.marker([store.lat, store.lng], { icon }).bindPopup(`
                <b style="font-size: 18px; font-weight: bold;">${store.name}</b><br>
                類型: ${store.type}<br>
                地址: ${store.address}<br>
                縣市: ${store.county}<br>
                鄉鎮市區: ${store.district}<br>
                <div class="d-flex justify-content-between mt-2">
                    <button type="button" class="btn btn-primary btn-sm" onclick="navigate('${store.address}', 'google')">
                        <img src="src/Google_maps.png" alt="Google Maps" style="width: 16px; height: 16px; margin-right: 5px;"> Google 地圖
                    </button>
                    <button type="button" class="btn btn-primary btn-sm" onclick="navigate('${store.address}', 'apple')">
                        <img src="src/Apple_maps.png" alt="Apple Maps" style="width: 16px; height: 16px; margin-right: 5px;"> Apple 地圖
                    </button>
                </div>
            `);

            if (isMarkerClusterEnabled) markers.addLayer(marker);
            else nonClusteredMarkers.addLayer(marker);
            searchMarkers[store.name] = marker;
        }
    });

    // === 自動聚焦 ===
    if (storesToDisplay.length === 0) {
        map.setView([23.5, 121], 8, { animate: true });
        return;
    }
    if (!window.hasInitialized) {
        window.hasInitialized = true;
        return;
    }
    const group = new L.featureGroup(isMarkerClusterEnabled ? markers.getLayers() : nonClusteredMarkers.getLayers());
    map.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 15, animate: true });
}

function toggleMarkerCluster() {
    isMarkerClusterEnabled = document.getElementById('markerClusterSwitch').checked;
    displayStores(getCurrentFilteredStores());
    debounceSave();
}

function filterMultiStoresLogic() {
    const storeTypes = Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(i => i.value);
    let filteredStores = stores;
    if (storeTypes.length > 0) {
        filteredStores = filteredStores.filter(s => storeTypes.includes(s.type.toLowerCase()));
    }

    const finalSelected = new Set();

    // 1. 鄉鎮勾選（優先）
    document.querySelectorAll('#multiFilterAccordion .checkbox-group input[type="checkbox"]:checked').forEach(cb => {
        const countyInput = cb.closest('.accordion-item').querySelector('.county-checkbox input');
        if (countyInput) {
            finalSelected.add(`${countyInput.value}|${cb.value}`);
        }
    });

    // 2. 縣市勾選（補足未被鄉鎮覆蓋的鄉鎮）
    document.querySelectorAll('#multiFilterAccordion .county-checkbox input[type="checkbox"]:checked').forEach(countyCb => {
        const county = countyCb.value;
        const allDistricts = [...new Set(filteredStores.filter(s => s.county === county).map(s => s.district))];
        allDistricts.forEach(d => {
            const key = `${county}|${d}`;
            if (!finalSelected.has(key)) {
                finalSelected.add(key);
            }
        });
    });

    // 3. 整方向全選
    document.querySelectorAll('#multiFilterAccordion > .accordion-item').forEach(item => {
        const direction = item.querySelector('.accordion-button').textContent.trim();
        const countyCbs = item.querySelectorAll('.county-checkbox input[type="checkbox"]');
        const allChecked = Array.from(countyCbs).every(cb => cb.checked);
        if (allChecked && countyCbs.length > 0) {
            filteredStores.filter(s => s.direction === direction).forEach(s => {
                const key = `${s.county}|${s.district}`;
                if (!finalSelected.has(key)) {
                    finalSelected.add(key);
                }
            });
        }
    });

    const selectedArray = Array.from(finalSelected).map(k => {
        const [c, d] = k.split('|');
        return { county: c, district: d };
    });

    if (selectedArray.length > 0) {
        filteredStores = filteredStores.filter(store =>
            selectedArray.some(item => item.county === store.county && item.district === store.district)
        );
    }

    return filteredStores;
}

function getCurrentFilteredStores() {
    const activeTab = document.querySelector('#filterTabs .nav-link.active').id;
    if (activeTab === 'filter-tab') {
        const storeTypes = Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(i => i.value);
        const county = document.getElementById('county').value;
        const district = document.getElementById('district').value;
        let filtered = stores;
        if (storeTypes.length > 0) filtered = filtered.filter(s => storeTypes.includes(s.type.toLowerCase()));
        if (county) filtered = filtered.filter(s => s.county === county);
        if (district) filtered = filtered.filter(s => s.district === district);
        return filtered;
    } else if (activeTab === 'multi-filter-tab') {
        return filterMultiStoresLogic();
    }
    return stores;
}

function filterStores() {
    displayStores(getCurrentFilteredStores());
    bootstrap.Offcanvas.getInstance(document.getElementById('offcanvasNavbar'))?.hide();
    debounceSave();
}

function filterMultiStores() {
    displayStores(filterMultiStoresLogic());
    bootstrap.Offcanvas.getInstance(document.getElementById('offcanvasNavbar'))?.hide();
    debounceSave();
}

function resetFilters() {
    document.querySelectorAll('input[name="store-type"]').forEach(cb => cb.checked = false);
    document.getElementById('county').value = '';
    document.getElementById('district').innerHTML = '<option value="">選擇鄉鎮市區</option>';
    populateCounties();
    displayStores(stores);
    debounceSave();
}

function resetMultiFilters() {
    document.querySelectorAll('input[name="multi-store-type"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#multiFilterAccordion input[type="checkbox"]').forEach(cb => cb.checked = false);
    populateMultiFilterAccordion();
    displayStores(stores);
    debounceSave();
}

function locateUser() {
    locateControl.start();
}

function navigate(address, mapType) {
    const url = mapType === 'google'
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
        : `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`;
    window.open(url, '_blank');
}

function toggleFilters() {
    const offcanvas = bootstrap.Offcanvas.getInstance(document.getElementById('offcanvasNavbar')) || new bootstrap.Offcanvas(document.getElementById('offcanvasNavbar'));
    offcanvas.toggle();
}

// === LocalStorage 儲存與載入 ===

function saveStateToStorage() {
    const selected = [];
    document.querySelectorAll('#multiFilterAccordion .checkbox-group input:checked').forEach(cb => {
        const county = cb.closest('.accordion-item').querySelector('.county-checkbox input').value;
        selected.push(`${county}|${cb.value}`);
    });
    document.querySelectorAll('#multiFilterAccordion .county-checkbox input[type="checkbox"]:checked').forEach(cb => {
        const county = cb.value;
        const hasSpecificDistrict = Array.from(cb.closest('.accordion-item').querySelectorAll('.checkbox-group input:checked')).length > 0;
        if (!hasSpecificDistrict) {
            selected.push(`${county}|*`);
        }
    });

    const currentState = JSON.stringify({
        t: document.querySelector('#filterTabs .nav-link.active')?.id || 'filter-tab',
        c: isMarkerClusterEnabled,
        s: Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(i => i.value),
        m: Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(i => i.value),
        f: selected,
        v: {
            lat: map.getCenter().lat.toFixed(6),
            lng: map.getCenter().lng.toFixed(6),
            z: map.getZoom()
        }
    });

    if (currentState !== lastSavedState) {
        localStorage.setItem(STORAGE_KEY, currentState);
        lastSavedState = currentState;
    }
}

function loadStateFromStorage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
        const state = JSON.parse(saved);

        // 簡單的資料驗證，防止舊結構導致錯誤
        if (!state || typeof state !== 'object') {
            throw new Error('儲存的狀態格式不正確');
        }

        if (state.t) {
            const tab = document.getElementById(state.t);
            if (tab) new bootstrap.Tab(tab).show();
        }

        if (state.c !== undefined) {
            isMarkerClusterEnabled = state.c;
            const sw = document.getElementById('markerClusterSwitch');
            if (sw) sw.checked = isMarkerClusterEnabled;
        }

        if (state.s && Array.isArray(state.s)) {
            document.querySelectorAll('input[name="store-type"]').forEach(cb => cb.checked = state.s.includes(cb.value));
            populateCounties();
        }

        if (state.m && Array.isArray(state.m)) {
            document.querySelectorAll('input[name="multi-store-type"]').forEach(cb => cb.checked = state.m.includes(cb.value));
            populateMultiFilterAccordion();
        }

        // 使用 requestAnimationFrame 確保 UI 渲染後再執行勾選，比 setTimeout 更穩定
        requestAnimationFrame(() => {
            if (state.f && Array.isArray(state.f)) {
                state.f.forEach(key => {
                    const [county, district] = key.split('|');
                    const countyCb = document.querySelector(`.county-checkbox input[value="${county}"]`);
                    if (countyCb) {
                        countyCb.checked = true;
                        // 自動展開邏輯保持不變
                        const collapseId = countyCb.closest('.accordion-header').getAttribute('data-bs-target');
                        if (collapseId) {
                            const collapseEl = document.querySelector(collapseId);
                            if (collapseEl) new bootstrap.Collapse(collapseEl, { toggle: false }).show();
                        }
                        if (district !== '*') {
                            const districtCb = document.querySelector(`input[name="district-${county}"][value="${district}"]`);
                            if (districtCb) districtCb.checked = true;
                        }
                    }
                });
            }

            const activeTab = document.querySelector('#filterTabs .nav-link.active')?.id;
            if (activeTab === 'filter-tab') filterStores();
            else if (activeTab === 'multi-filter-tab') filterMultiStores();
            else displayStores(stores);

            if (state.v && state.v.lat && state.v.lng) {
                map.setView([parseFloat(state.v.lat), parseFloat(state.v.lng)], state.v.z, { animate: false });
            }
        });

    } catch (e) {
        console.error("載入狀態失敗，可能是資料過期或結構變更，將自動清除舊紀錄。", e);
        localStorage.removeItem(STORAGE_KEY);
        // 選擇性：重整頁面或重置過濾器
        // location.reload(); 
    }
}

function clearSavedState() {
    if (confirm('確定要清除所有操作紀錄？')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }
}

// 新增：尋找附近店家功能
function findNearbyStores() {
    const resultList = document.getElementById('nearbyResultsList');
    const offcanvas = new bootstrap.Offcanvas(document.getElementById('offcanvasBottom'));
    
    resultList.innerHTML = '<div class="text-center p-3"><div class="spinner-border text-primary" role="status"></div><div class="mt-2">正在定位中...</div></div>';
    offcanvas.show();

    if (!navigator.geolocation) {
        resultList.innerHTML = '<div class="alert alert-danger">您的瀏覽器不支援地理定位功能。</div>';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const userLat = position.coords.latitude;
            const userLon = position.coords.longitude;

            // 計算所有店家的距離
            const storesWithDist = stores.map(store => ({
                ...store,
                distance: calculateDistance(userLat, userLon, store.lat, store.lng)
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 20); // 只取最近的 20 間

            renderNearbyList(storesWithDist, offcanvas);
            
            // 移動地圖到使用者位置
            map.setView([userLat, userLon], 16); // Zoom 拉近一點比較清楚
            
            // 若有定位控制項，更新藍點 (確保藍點與列表位置一致)
            if(locateControl) locateControl.start();
        },
        (error) => {
            console.error("定位失敗:", error.message);
            let errorMsg = "無法獲取您的位置。";
            if (error.code === 1) errorMsg = "請允許瀏覽器存取您的位置。";
            else if (error.code === 3) errorMsg = "定位逾時，請走到戶外或空曠處再試。";
            
            resultList.innerHTML = `<div class="alert alert-danger">${errorMsg}<br><small>建議：檢查手機定位是否開啟，或稍後再試。</small></div>`;
        },
        { 
            enableHighAccuracy: true, // 盡量精準
            timeout: 15000,           // 等待時間延長至 15 秒 (原本 5 秒太短)
            maximumAge: 30000         // 接受 30 秒內的快取位置 (這是解決問題的關鍵)
        }
    );
}

function renderNearbyList(storesList, offcanvasInstance) {
    const resultList = document.getElementById('nearbyResultsList');
    if (storesList.length === 0) {
        resultList.innerHTML = '<div class="p-3">附近沒有找到店家。</div>';
        return;
    }

    let html = '<div class="list-group list-group-flush">';
    storesList.forEach(store => {
        html += `
            <a href="#" class="list-group-item list-group-item-action" onclick="focusOnNearbyStore('${store.name}', ${store.lat}, ${store.lng})">
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1 fw-bold">${store.name}</h6>
                    <small class="text-primary fw-bold">${store.distance.toFixed(2)} km</small>
                </div>
                <small class="text-muted">${store.address}</small>
            </a>
        `;
    });
    html += '</div>';
    resultList.innerHTML = html;
}

function focusOnNearbyStore(name, lat, lng) {
    // 關閉底部面板
    const offcanvasEl = document.getElementById('offcanvasBottom');
    const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasEl);
    if (offcanvasInstance) offcanvasInstance.hide();

    // 移動地圖
    map.setView([lat, lng], 16);
    
    // 開啟 Popup
    const marker = searchMarkers[name];
    if (marker) {
        // 如果是在 cluster 內，需要先展開 cluster (Leaflet.markercluster 會自動處理 zoom)
        if (isMarkerClusterEnabled) {
            markers.zoomToShowLayer(marker, () => marker.openPopup());
        } else {
            marker.openPopup();
        }
    }
}



document.querySelectorAll('#filterTabs .nav-link').forEach(tab => {
    tab.addEventListener('shown.bs.tab', debounceSave);
});

document.addEventListener('DOMContentLoaded', initMap);