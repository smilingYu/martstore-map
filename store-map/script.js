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

// LocalStorage 與 Cookie 備援
const STORAGE_KEY = 'storeMapState';
let lastSavedState = '';
let saveTimeout;
let storageAvailable = true;

// 檢查 localStorage 是否可用
function checkStorageAvailable() {
    try {
        const test = '__storage_test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
    } catch (e) {
        console.warn('LocalStorage 不可用，將使用 Cookie 作為備援');
        return false;
    }
}

// Cookie 操作函數
function setCookie(name, value, days = 30) {
    try {
        const expires = new Date();
        expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
        // 壓縮數據
        const compressed = btoa(encodeURIComponent(value));
        document.cookie = `${name}=${compressed};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
        return true;
    } catch (e) {
        console.error('Cookie 設置失敗:', e);
        return false;
    }
}

function getCookie(name) {
    try {
        const nameEQ = name + '=';
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) {
                const compressed = c.substring(nameEQ.length, c.length);
                return decodeURIComponent(atob(compressed));
            }
        }
        return null;
    } catch (e) {
        console.error('Cookie 讀取失敗:', e);
        return null;
    }
}

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
        // displayStores(stores); // 預設不顯示所有店家標記
        initializeSearch();

        // 設定初始化完成旗標，讓使用者第一次篩選時就能自動調整視角
        window.hasInitialized = true;
        
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
                // 先立即顯示結果（按名稱排序）
                const initialStores = filteredStores
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .slice(0, 10);
                renderSearchResults(initialStores);
                
                // 然後在背景嘗試獲取位置並更新排序
                if (abortController) abortController.abort();
                abortController = new AbortController();
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        if (currentQuery !== query) return;
                        const userLat = position.coords.latitude;
                        const userLon = position.coords.longitude;
                        // 只對已過濾的店家計算距離
                        const storesWithDistance = filteredStores
                            .map(store => ({ ...store, distance: calculateDistance(userLat, userLon, store.lat, store.lng) }))
                            .sort((a, b) => a.distance - b.distance)
                            .slice(0, 10);
                        renderSearchResults(storesWithDistance);
                    },
                    (error) => {
                        // 定位失敗時不需要做任何事，因為已經顯示了初始結果
                    },
                    { 
                        enableHighAccuracy: false, // 改為 false 加快速度
                        timeout: 3000, // 3秒超時
                        maximumAge: 10000, // 接受 10 秒內的快取位置
                        signal: abortController.signal 
                    }
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

// 全域變數儲存當前選擇的區域資料
let currentRegionSelection = {
    direction: '',
    county: '',
    districts: new Set()
};

function populateMultiFilterAccordion() {
    const storeTypes = Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(i => i.value);
    let filteredStores = stores;
    if (storeTypes.length > 0) filteredStores = stores.filter(s => storeTypes.includes(s.type.toLowerCase()));
    
    // 建立區域選擇器的資料結構
    window.regionData = {};
    const directions = [...new Set(filteredStores.map(s => s.direction))].sort();
    
    directions.forEach(direction => {
        const counties = [...new Set(filteredStores.filter(s => s.direction === direction).map(s => s.county))].sort();
        window.regionData[direction] = {};
        
        counties.forEach(county => {
            const districts = [...new Set(filteredStores.filter(s => s.county === county).map(s => s.district))].sort();
            const storeCount = filteredStores.filter(s => s.county === county).length;
            window.regionData[direction][county] = {
                districts: districts,
                count: storeCount,
                districtCounts: {}
            };
            
            districts.forEach(district => {
                const districtCount = filteredStores.filter(s => s.county === county && s.district === district).length;
                window.regionData[direction][county].districtCounts[district] = districtCount;
            });
        });
    });
}

function openRegionSelector() {
    const modal = document.getElementById('regionSelectorModal');
    if (!modal) {
        console.error('找不到區域選擇器 Modal');
        return;
    }
    
    // 初始化三欄
    populateDirectionList();
    
    // 清空第三欄
    const districtListPanel = document.getElementById('districtList');
    if (districtListPanel) {
        districtListPanel.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">請先選擇縣市</div>';
    }
    
    // 在行動裝置上，預設展開第一個面板（區域）
    if (window.innerWidth <= 768) {
        const directionPanel = document.querySelector('.direction-panel');
        if (directionPanel) {
            directionPanel.classList.add('expanded');
        }
    }
    
    // 顯示 Modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

// 行動裝置面板展開/收合功能
function togglePanel(panelType) {
    // 只在行動裝置上啟用摺疊功能
    if (window.innerWidth > 768) {
        return;
    }
    
    const panel = document.querySelector(`[data-panel="${panelType}"]`);
    if (!panel) return;
    
    const isExpanded = panel.classList.contains('expanded');
    
    if (isExpanded) {
        // 收合當前面板
        panel.classList.remove('expanded');
    } else {
        // 收合其他面板，展開當前面板
        document.querySelectorAll('.direction-panel, .county-panel, .district-panel').forEach(p => {
            p.classList.remove('expanded');
        });
        panel.classList.add('expanded');
    }
}

function populateDirectionList() {
    const directionList = document.getElementById('directionList');
    if (!directionList || !window.regionData) return;
    
    const directions = Object.keys(window.regionData);
    let html = '';
    
    directions.forEach((direction, index) => {
        const isActive = index === 0 ? 'active' : '';
        html += `
            <div class="direction-item ${isActive}" onclick="selectDirection(event, '${direction}')">
                <span>${direction}</span>
                <i class="bi bi-chevron-right"></i>
            </div>
        `;
    });
    
    directionList.innerHTML = html;
    
    // 預設選擇第一個區域
    if (directions.length > 0) {
        selectDirection(null, directions[0]);
    }
}

function selectDirection(event, direction) {
    // 更新左側選中狀態
    document.querySelectorAll('.direction-item').forEach(item => {
        item.classList.remove('active');
    });
    if (event) {
        event.target.closest('.direction-item').classList.add('active');
    } else {
        // 如果沒有 event (初始化時)，直接選中第一個
        const firstItem = document.querySelector('.direction-item');
        if (firstItem) firstItem.classList.add('active');
    }
    
    currentRegionSelection.direction = direction;
    
    // 更新右側縣市列表
    populateCountyList(direction);
}

function populateCountyList(direction) {
    const countyList = document.getElementById('countyList');
    if (!countyList || !window.regionData[direction]) return;
    
    const counties = Object.keys(window.regionData[direction]);
    let html = '';
    
    counties.forEach(county => {
        const data = window.regionData[direction][county];
        const selectedCount = getSelectedCountInCounty(county);
        const hasSelection = selectedCount > 0;
        
        html += `
            <div class="county-item ${hasSelection ? 'has-selection' : ''}" onclick="selectCounty(event, '${county}')" data-county="${county}">
                <span class="county-name">${county}</span>
                <span class="store-count">${data.count} 家</span>
                ${hasSelection ? `<span class="selected-badge">${selectedCount}</span>` : ''}
            </div>
        `;
    });
    
    countyList.innerHTML = html || '<div style="padding: 20px; text-align: center; color: #999;">請先選擇區域</div>';
}

function selectCounty(event, county) {
    // 更新縣市選中狀態
    document.querySelectorAll('.county-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    currentRegionSelection.county = county;
    
    // 更新右側鄉鎮市區列表
    populateDistrictList(currentRegionSelection.direction, county);
}

function populateDistrictList(direction, county) {
    const districtListPanel = document.getElementById('districtList');
    if (!districtListPanel || !window.regionData[direction] || !window.regionData[direction][county]) {
        if (districtListPanel) {
            districtListPanel.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">請先選擇縣市</div>';
        }
        return;
    }
    
    const data = window.regionData[direction][county];
    let html = '';
    
    data.districts.forEach(district => {
        const isChecked = selectedRegions.has(county) && selectedRegions.get(county).has(district);
        html += `
            <div class="district-item">
                <input type="checkbox" 
                       class="district-checkbox"
                       data-county="${county}" 
                       data-district="${district}"
                       ${isChecked ? 'checked' : ''}
                       onchange="handleDistrictCheckbox(event, '${county}', '${district}')">
                <label onclick="event.preventDefault(); event.currentTarget.previousElementSibling.click();">
                    <span>${district}</span>
                    <span class="district-count">${data.districtCounts[district]} 家</span>
                </label>
            </div>
        `;
    });
    
    districtListPanel.innerHTML = html;
}

function handleDistrictCheckbox(event, county, district) {
    const checkbox = event.target;
    
    if (checkbox.checked) {
        addSelection(county, district);
    } else {
        removeSelection(county, district);
    }
    
    // 更新已選擇標籤
    updateSelectedTags();
    
    // 更新縣市列表中的已選數量徽章
    updateCountyBadge(county);
}

function updateCountyBadge(county) {
    const countyItem = document.querySelector(`.county-item[data-county="${county}"]`);
    if (!countyItem) return;
    
    const selectedCount = getSelectedCountInCounty(county);
    
    // 移除舊徽章
    const oldBadge = countyItem.querySelector('.selected-badge');
    if (oldBadge) oldBadge.remove();
    
    // 更新狀態
    if (selectedCount > 0) {
        countyItem.classList.add('has-selection');
        const badge = document.createElement('span');
        badge.className = 'selected-badge';
        badge.textContent = selectedCount;
        countyItem.appendChild(badge);
    } else {
        countyItem.classList.remove('has-selection');
    }
}

// 選擇管理
let selectedRegions = new Map(); // Map<county, Set<district>>

function addSelection(county, district) {
    if (!selectedRegions.has(county)) {
        selectedRegions.set(county, new Set());
    }
    selectedRegions.get(county).add(district);
}

function removeSelection(county, district) {
    if (selectedRegions.has(county)) {
        selectedRegions.get(county).delete(district);
        if (selectedRegions.get(county).size === 0) {
            selectedRegions.delete(county);
        }
    }
}

function getSelectedCountInCounty(county) {
    return selectedRegions.has(county) ? selectedRegions.get(county).size : 0;
}

function restoreSelectionState() {
    selectedRegions.forEach((districts, county) => {
        // 更新縣市徽章
        updateCountyBadge(county);
        
        // 如果當前選中的縣市，更新鄉鎮市區的勾選狀態
        if (currentRegionSelection.county === county) {
            districts.forEach(district => {
                const checkbox = document.querySelector(`.district-checkbox[data-county="${county}"][data-district="${district}"]`);
                if (checkbox) checkbox.checked = true;
            });
        }
    });
}

function updateSelectedTags() {
    const container = document.getElementById('selectedRegionTags');
    const countDisplay = document.getElementById('selectedRegionCount');
    if (!container) return;
    
    let html = '';
    let totalCount = 0;
    
    selectedRegions.forEach((districts, county) => {
        districts.forEach(district => {
            totalCount++;
            html += `
                <span class="region-tag">
                    ${county} ${district}
                    <i class="bi bi-x" onclick="removeTagSelection('${county}', '${district}')"></i>
                </span>
            `;
        });
    });
    
    container.innerHTML = html;
    
    if (countDisplay) {
        countDisplay.textContent = `已選擇: ${totalCount}`;
    }
    
    // 如果沒有選擇，顯示提示
    if (totalCount === 0) {
        container.innerHTML = '<span class="text-muted">尚未選擇任何區域</span>';
    }
}

function removeTagSelection(county, district) {
    removeSelection(county, district);
    
    // 更新 UI
    const checkbox = document.querySelector(`.district-checkbox[data-county="${county}"][data-district="${district}"]`);
    if (checkbox) {
        checkbox.checked = false;
        updateCountyCheckboxState(county);
    }
    
    updateSelectedTags();
}

function confirmRegionSelection() {
    // 更新頁面上的已選擇標籤顯示
    updateMainSelectedTags();
    
    // 關閉 Modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('regionSelectorModal'));
    if (modal) modal.hide();
    
    // 執行篩選
    filterMultiStores();
}

function updateMainSelectedTags() {
    const container = document.getElementById('mainSelectedTags');
    if (!container) return;
    
    let html = '';
    
    selectedRegions.forEach((districts, county) => {
        districts.forEach(district => {
            html += `
                <span class="selected-tag">
                    ${county} ${district}
                    <i class="bi bi-x-circle" onclick="removeMainTagSelection('${county}', '${district}')"></i>
                </span>
            `;
        });
    });
    
    if (html === '') {
        container.innerHTML = '';
        container.style.display = 'none';
    } else {
        container.innerHTML = html;
        container.style.display = 'flex';
    }
}

function removeMainTagSelection(county, district) {
    removeSelection(county, district);
    updateMainSelectedTags();
    filterMultiStores();
}

function clearAllRegionSelections() {
    selectedRegions.clear();
    
    // 清除所有縣市的徽章
    document.querySelectorAll('.county-item').forEach(item => {
        item.classList.remove('has-selection');
        const badge = item.querySelector('.selected-badge');
        if (badge) badge.remove();
    });
    
    // 清除第三欄所有的複選框
    document.querySelectorAll('.district-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // 更新 Modal 底部的已選擇標籤顯示
    updateSelectedTags();
}

function updateMultiFilterAccordion() {
    populateMultiFilterAccordion();
    debounceSave();
}

function handleCheckboxChange(event) {
    event.stopPropagation();
    // 只阻止事件冒泡，不自動展開手風琴
    // 使用者需要點擊右側箭頭按鈕才能展開/收合手風琴
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
    
    // 取得目前已顯示的標記
    const currentLayers = isMarkerClusterEnabled ? nonClusteredMarkers.getLayers() : markers.getLayers();
    
    // 如果沒有任何標記在地圖上,就不需要重新顯示
    if (currentLayers.length === 0) {
        debounceSave();
        return;
    }
    
    // 只切換叢集模式,保持目前的篩選結果
    const currentStores = [];
    currentLayers.forEach(marker => {
        const latlng = marker.getLatLng();
        const store = stores.find(s => s.lat === latlng.lat && s.lng === latlng.lng);
        if (store) currentStores.push(store);
    });
    
    displayStores(currentStores);
    debounceSave();
}

function filterMultiStoresLogic() {
    const storeTypes = Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(i => i.value);
    let filteredStores = stores;
    if (storeTypes.length > 0) {
        filteredStores = filteredStores.filter(s => storeTypes.includes(s.type.toLowerCase()));
    }

    // 使用新的選擇器資料
    if (selectedRegions.size === 0) {
        return []; // 沒有選擇任何區域時返回空陣列
    }

    const filtered = filteredStores.filter(store => {
        if (selectedRegions.has(store.county)) {
            const districts = selectedRegions.get(store.county);
            return districts.has(store.district);
        }
        return false;
    });

    return filtered;
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
    // 重置後清空地圖標記
    markers.clearLayers();
    nonClusteredMarkers.clearLayers();
    map.setView([23.5, 121], 8);
    debounceSave();
}

function resetMultiFilters() {
    document.querySelectorAll('input[name="multi-store-type"]').forEach(cb => cb.checked = false);
    
    // 清除區域選擇
    selectedRegions.clear();
    updateMainSelectedTags();
    
    // 重置後清空地圖標記
    markers.clearLayers();
    nonClusteredMarkers.clearLayers();
    map.setView([23.5, 121], 8);
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
    try {
        // 轉換 selectedRegions Map 為可序列化的格式
        const selectedRegionsArray = [];
        selectedRegions.forEach((districts, county) => {
            districts.forEach(district => {
                selectedRegionsArray.push(`${county}|${district}`);
            });
        });

        const currentState = JSON.stringify({
            t: document.querySelector('#filterTabs .nav-link.active')?.id || 'filter-tab',
            c: isMarkerClusterEnabled,
            s: Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(i => i.value),
            county: document.getElementById('county')?.value || '',
            district: document.getElementById('district')?.value || '',
            m: Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(i => i.value),
            f: selectedRegionsArray,
            v: {
                lat: map.getCenter().lat.toFixed(6),
                lng: map.getCenter().lng.toFixed(6),
                z: map.getZoom()
            },
            timestamp: Date.now()
        });

        if (currentState !== lastSavedState) {
            let saved = false;
            
            // 嘗試使用 localStorage
            if (storageAvailable) {
                try {
                    localStorage.setItem(STORAGE_KEY, currentState);
                    saved = true;
                } catch (e) {
                    console.warn('LocalStorage 儲存失敗，切換到 Cookie:', e);
                    storageAvailable = false;
                }
            }
            
            // 如果 localStorage 失敗，使用 Cookie
            if (!saved) {
                saved = setCookie(STORAGE_KEY, currentState);
            }
            
            if (saved) {
                lastSavedState = currentState;
            } else {
                console.error('所有儲存方式都失敗');
            }
        }
    } catch (error) {
        console.error('儲存狀態時發生錯誤:', error);
    }
}

function loadStateFromStorage() {
    // 初始化時檢查儲存可用性
    storageAvailable = checkStorageAvailable();
    
    // 嘗試從 localStorage 或 Cookie 載入
    let saved = null;
    
    if (storageAvailable) {
        try {
            saved = localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            console.warn('LocalStorage 讀取失敗，嘗試從 Cookie 讀取:', e);
            storageAvailable = false;
        }
    }
    
    // 如果 localStorage 失敗或不可用，嘗試從 Cookie 讀取
    if (!saved) {
        saved = getCookie(STORAGE_KEY);
    }
    
    if (!saved) {
        console.log('沒有找到儲存的狀態');
        return;
    }

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
            
            // 還原單一篩選的縣市和鄉鎮市區
            if (state.county) {
                const countySelect = document.getElementById('county');
                if (countySelect) {
                    countySelect.value = state.county;
                    updateDistricts();
                    
                    if (state.district) {
                        // 使用 requestAnimationFrame 確保 district 選單已更新
                        requestAnimationFrame(() => {
                            const districtSelect = document.getElementById('district');
                            if (districtSelect) {
                                districtSelect.value = state.district;
                            }
                        });
                    }
                }
            }
        }

        if (state.m && Array.isArray(state.m)) {
            document.querySelectorAll('input[name="multi-store-type"]').forEach(cb => cb.checked = state.m.includes(cb.value));
            populateMultiFilterAccordion();
        }

        // 還原區域選擇器的資料
        if (state.f && Array.isArray(state.f)) {
            selectedRegions.clear();
            state.f.forEach(key => {
                const [county, district] = key.split('|');
                if (county && district) {
                    addSelection(county, district);
                }
            });
            updateMainSelectedTags();
        }

        // 使用 requestAnimationFrame 確保 UI 渲染後再執行
        requestAnimationFrame(() => {
            const activeTab = document.querySelector('#filterTabs .nav-link.active')?.id;
            if (activeTab === 'filter-tab') filterStores();
            else if (activeTab === 'multi-filter-tab') filterMultiStores();

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
        // 清除 localStorage
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            console.warn('LocalStorage 清除失敗:', e);
        }
        
        // 清除 Cookie
        try {
            document.cookie = `${STORAGE_KEY}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        } catch (e) {
            console.warn('Cookie 清除失敗:', e);
        }
        
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