let map;
let markers = L.markerClusterGroup();
let nonClusteredMarkers = L.layerGroup();
let isMarkerClusterEnabled = true;
let locateControl;
let stores = [];
let deferredPrompt;
let searchMarkers = {};

// LocalStorage 鍵名
const STORAGE_KEYS = {
    MARKER_CLUSTER: 'markerClusterEnabled',
    FILTER_TAB: 'activeFilterTab',
    FILTER_STORE_TYPES: 'filterStoreTypes',
    FILTER_COUNTY: 'filterCounty',
    FILTER_DISTRICT: 'filterDistrict',
    MULTI_STORE_TYPES: 'multiFilterStoreTypes',
    MULTI_SELECTIONS: 'multiFilterSelections'
};

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        maxBoundsViscosity: 1.0
    }).setView([23.5, 121], 8);
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
        circleStyle: {
            color: '#3388ff',
            fillColor: '#3388ff',
            fillOpacity: 0.2,
            weight: 2,
            opacity: 1,
            radius: 1000
        },
        markerStyle: {
            fillColor: '#2A93EE',
            fillOpacity: 1,
            color: '#fff',
            weight: 3
        },
        showPopup: true,
        strings: {
            title: "顯示我的位置",
            popup: "您的位置"
        },
        locateOptions: {
            enableHighAccuracy: true
        },
        onLocationError: function(err) {
            console.error("無法獲取您的位置：" + err.message);
        }
    }).addTo(map);
    loadStores();
    locateControl.start();
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const shortcutBtn = document.getElementById('desktopShortcutBtn');
    if (shortcutBtn) {
        shortcutBtn.style.display = 'block';
    }
});

async function loadStores() {
    try {
        const response = await fetch('store_coordinates.json');
        if (!response.ok) throw new Error('無法載入店家資料');
        stores = await response.json();
        populateCounties();
        populateMultiFilterAccordion();
        displayStores(stores);
        initializeSearch();

        // 資料載入完成後，恢復上次操作狀態
        loadStateFromStorage();

    } catch (error) {
        console.error(error);
        alert('載入店家資料失敗，請稍後再試');
    }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // 地球半徑（公里）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // 距離（公里）
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
                // 取消之前的定位請求
                if (abortController) {
                    abortController.abort();
                }
                abortController = new AbortController();
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        // 檢查是否為最新查詢
                        if (currentQuery !== query) return;
                        const userLat = position.coords.latitude;
                        const userLon = position.coords.longitude;
                        const storesWithDistance = filteredStores
                            .map(store => ({
                                ...store,
                                distance: calculateDistance(userLat, userLon, store.lat, store.lng)
                            }))
                            .sort((a, b) => a.distance - b.distance)
                            .slice(0, 10); // 限制最多 10 個結果
                        searchResults.style.display = 'block';
                        searchResults.innerHTML = ''; // 清空並重新填充
                        storesWithDistance.forEach(store => {
                            const item = document.createElement('div');
                            item.className = 'list-group-item';
                            item.innerHTML = `
                                ${store.name}
                                <span class="distance">(${store.distance.toFixed(2)} 公里)</span>
                            `;
                            item.setAttribute('aria-label', `選擇店家 ${store.name}，距離 ${store.distance.toFixed(2)} 公里`);
                            item.addEventListener('click', () => {
                                focusOnStore(store);
                                searchResults.innerHTML = '';
                                searchResults.style.display = 'none';
                                searchInput.value = '';
                            });
                            searchResults.appendChild(item);
                        });
                    },
                    (error) => {
                        // 檢查是否為最新查詢
                        if (currentQuery !== query) return;
                        console.error("定位失敗:", error);
                        // 按名稱排序，無距離顯示
                        const sortedStores = filteredStores
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .slice(0, 10); // 限制最多 10 個結果
                        searchResults.style.display = 'block';
                        searchResults.innerHTML = ''; // 清空並重新填充
                        sortedStores.forEach(store => {
                            const item = document.createElement('div');
                            item.className = 'list-group-item';
                            item.textContent = store.name;
                            item.setAttribute('aria-label', `選擇店家 ${store.name}`);
                            item.addEventListener('click', () => {
                                focusOnStore(store);
                                searchResults.innerHTML = '';
                                searchResults.style.display = 'none';
                                searchInput.value = '';
                            });
                            searchResults.appendChild(item);
                        });
                    },
                    {
                        enableHighAccuracy: true,
                        signal: abortController.signal // 支持取消
                    }
                );
            }
        }
    };

    // 防抖：300ms 延遲
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
    if (debounceTimer) clearTimeout(debounceTimer); // 清除防抖計時器
    if (abortController) abortController.abort(); // 取消定位
    displayStores(getCurrentFilteredStores());
}

function populateCounties() {
    const countySelect = document.getElementById('county');
    countySelect.innerHTML = '<option value="">選擇縣市</option>';
    const storeTypes = Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(input => input.value);
    let filteredStores = stores;
    if (storeTypes.length > 0) {
        filteredStores = stores.filter(store => storeTypes.includes(store.type.toLowerCase()));
    }
    const counties = [...new Set(filteredStores.map(store => store.county))].sort();
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
    saveStateToStorage();  // 自動儲存
}

function updateDistricts() {
    const countySelect = document.getElementById('county');
    const districtSelect = document.getElementById('district');
    districtSelect.innerHTML = '<option value="">選擇鄉鎮市區</option>';
    const storeTypes = Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(input => input.value);
    const selectedCounty = countySelect.value;
    if (selectedCounty) {
        let filteredStores = stores;
        if (storeTypes.length > 0) {
            filteredStores = filteredStores.filter(store => storeTypes.includes(store.type.toLowerCase()));
        }
        const districts = [...new Set(filteredStores.filter(store => store.county === selectedCounty).map(store => store.district))].sort();
        districts.forEach(district => {
            const option = document.createElement('option');
            option.value = district;
            option.textContent = district;
            districtSelect.appendChild(option);
        });
    }
    saveStateToStorage();  // 自動儲存
}

function populateMultiFilterAccordion() {
    const accordionDiv = document.getElementById('multiFilterAccordion');
    const storeTypes = Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(input => input.value);
    let filteredStores = stores;
    if (storeTypes.length > 0) {
        filteredStores = stores.filter(store => storeTypes.includes(store.type.toLowerCase()));
    }
    const directions = [...new Set(filteredStores.map(store => store.direction))].sort();
    accordionDiv.innerHTML = '';
    let index = 0;
    for (const direction of directions) {
        const counties = [...new Set(filteredStores.filter(store => store.direction === direction).map(store => store.county))].sort();
        accordionDiv.innerHTML += `
            <div class="accordion-item">
                <h2 class="accordion-header" id="headingDirection${index}">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseDirection${index}" data-bs-allow-multiple="true" aria-expanded="false" aria-controls="collapseDirection${index}">
                        ${direction}
                    </button>
                </h2>
                <div id="collapseDirection${index}" class="accordion-collapse collapse" aria-labelledby="headingDirection${index}">
                    <div class="accordion-body">
                        ${counties.map(county => {
                            const districts = [...new Set(filteredStores.filter(store => store.county === county).map(store => store.district))].sort();
                            const storeCount = filteredStores.filter(store => store.county === county).length;
                            return `
                                <div class="accordion-item">
                                    <h2 class="accordion-header" id="headingCounty${index}-${counties.indexOf(county)}">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseCounty${index}-${counties.indexOf(county)}" data-bs-allow-multiple="true" aria-expanded="false" aria-controls="collapseCounty${index}-${counties.indexOf(county)}">
                                            <span class="county-checkbox"><input type="checkbox" name="county" value="${county}" onchange="handleCheckboxChange(event)" aria-label="選擇${county}"> ${county}</span>
                                            <span class="store-count">(${storeCount})</span>
                                        </button>
                                    </h2>
                                    <div id="collapseCounty${index}-${counties.indexOf(county)}" class="accordion-collapse collapse" aria-labelledby="headingCounty${index}-${counties.indexOf(county)}">
                                        <div class="accordion-body checkbox-group">
                                            ${districts.map(district => {
                                                const districtStoreCount = filteredStores.filter(store => store.county === county && store.district === district).length;
                                                return `
                                                    <label>
                                                        <input type="checkbox" name="district-${county}" value="${district}" onchange="handleCheckboxChange(event)" aria-label="選擇${district}">
                                                        ${district}
                                                        <span class="district-count">(${districtStoreCount})</span>
                                                    </label><br>
                                                `;
                                            }).join('')}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
        index++;
    }
}

function updateMultiFilterAccordion() {
    populateMultiFilterAccordion();
    saveStateToStorage();  // 自動儲存
}

function handleCheckboxChange(event) {
    event.stopPropagation();
    saveStateToStorage();  // 手風琴勾選變更時儲存
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
    storesToDisplay.forEach(store => {
        if (store.lat && store.lng) {
            // === 取代原本的 switch icon 區塊 ===
                const storeName = store.name.replace(/"/g, '&quot;'); // 防止 HTML 注入

                let logoSrc = '';
                switch (store.type.toLowerCase()) {
                    case 'carrefour':
                    case '家樂福':
                        logoSrc = 'src/carrefour-logo.png';
                        break;
                    case 'pxmart':
                    case '全聯':
                        logoSrc = 'src/pxmart-logo.png';
                        break;
                    case 'rt-mart':
                    case '大潤發':
                        logoSrc = 'src/rtmart-logo.png';
                        break;
                    case 'ssafe':
                    case '大買家':
                        logoSrc = 'src/ssafe-logo.png';
                        break;
                    default:
                        logoSrc = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';
                }

                const icon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `
                        <div style="text-align: center; line-height: 1.2;">
                            <img src="${logoSrc}" style="width: 32px; height: 32px; display: block; margin: 0 auto;">
                            <div style="font-size: 12px; font-weight: bold; color: #ff0000ff; white-space: nowrap; margin-top: 4px; text-shadow: 1px 1px 2px white;">
                                ${storeName}
                            </div>
                    </div>
                `,
                iconSize: [100, 50],     // 寬度足夠容納文字，高度包含圖示+文字
                 iconAnchor: [50, 50],    // 定位點在圖示+文字的中心底部
                 popupAnchor: [0, -40]    // popup 相對位置
            });
            const marker = L.marker([store.lat, store.lng], { icon })
                .bindPopup(`
                    <b style="font-size: 18px; font-weight: bold;">${store.name}</b><br>
                    類型: ${store.type}<br>
                    地址: ${store.address}<br>
                    縣市: ${store.county}<br>
                    鄉鎮市區: ${store.district}<br>
                    <div class="d-flex justify-content-between">
                        <button type="button" class="btn btn-primary" onclick="navigate('${store.address}', 'google')">
                            <img src="src/Google_maps.png" alt="Google Maps" style="width: 16px; height: 16px; margin-right: 5px;"> Google 地圖
                        </button>
                        <button type="button" class="btn btn-primary" onclick="navigate('${store.address}', 'apple')">
                            <img src="src/Apple_maps.png" alt="Apple Maps" style="width: 16px; height: 16px; margin-right: 5px;"> Apple 地圖
                        </button>
                    </div>
                `);
            if (isMarkerClusterEnabled) {
                markers.addLayer(marker);
            } else {
                nonClusteredMarkers.addLayer(marker);
            }
            searchMarkers[store.name] = marker;
        }
    });
    if (storesToDisplay.length > 0) {
        const group = new L.featureGroup(isMarkerClusterEnabled ? markers.getLayers() : nonClusteredMarkers.getLayers());
        map.fitBounds(group.getBounds(), { padding: [0, 0] });
    }
}

//製作地圖標記叢集開關功能
function toggleMarkerCluster() {
    isMarkerClusterEnabled = document.getElementById('markerClusterSwitch').checked;
    const currentStores = getCurrentFilteredStores();
    displayStores(currentStores);
    saveStateToStorage();  // 自動儲存
}

function getCurrentFilteredStores() {
    const activeTab = document.querySelector('#filterTabs .nav-link.active').id;
    if (activeTab === 'filter-tab') {
        const storeTypes = Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(input => input.value);
        const county = document.getElementById('county').value;
        const district = document.getElementById('district').value;
        let filteredStores = stores;
        if (storeTypes.length > 0) {
            filteredStores = filteredStores.filter(store => storeTypes.includes(store.type.toLowerCase()));
        }
        if (county) {
            filteredStores = filteredStores.filter(store => store.county === county);
        }
        if (district) {
            filteredStores = filteredStores.filter(store => store.district === district);
        }
        return filteredStores;
    } else if (activeTab === 'multi-filter-tab') {
        const storeTypes = Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(input => input.value);
        let filteredStores = stores;
        if (storeTypes.length > 0) {
            filteredStores = filteredStores.filter(store => storeTypes.includes(store.type.toLowerCase()));
        }
        const selectedDistricts = [];
        const accordionDiv = document.getElementById('multiFilterAccordion');
        accordionDiv.querySelectorAll('.accordion-body').forEach(body => {
            if (body.classList.contains('checkbox-group')) {
                const county = body.parentElement.previousElementSibling.querySelector('.county-checkbox input').value;
                const checkedDistricts = Array.from(body.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
                checkedDistricts.forEach(district => selectedDistricts.push({ county, district }));
            } else {
                const direction = body.parentElement.previousElementSibling.querySelector('.accordion-button').textContent.trim();
                const checkedCounties = Array.from(body.querySelectorAll('.county-checkbox input[type="checkbox"]:checked')).map(input => input.value);
                if (checkedCounties.length > 0) {
                    checkedCounties.forEach(county => {
                        const districts = [...new Set(filteredStores.filter(store => store.county === county).map(store => store.district))].sort();
                        districts.forEach(district => selectedDistricts.push({ county, district }));
                    });
                } else {
                    const directionCounties = body.querySelectorAll('.county-checkbox input[type="checkbox"]');
                    const allChecked = Array.from(directionCounties).every(cb => cb.checked);
                    if (allChecked) {
                        const directionDistricts = [...new Set(filteredStores.filter(store => store.direction === direction).map(store => store.district))].sort();
                        filteredStores.filter(store => store.direction === direction).forEach(store => {
                            directionDistricts.forEach(district => selectedDistricts.push({ county: store.county, district }));
                        });
                    }
                }
            }
        });
        if (selectedDistricts.length > 0) {
            filteredStores = filteredStores.filter(store => {
                return selectedDistricts.some(item => item.county === store.county && item.district === store.district);
            });
        }
        return filteredStores;
    }
    return stores;
}

function filterStores() {
    const storeTypes = Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(input => input.value);
    const county = document.getElementById('county').value;
    const district = document.getElementById('district').value;
    let filteredStores = stores;
    if (storeTypes.length > 0) {
        filteredStores = filteredStores.filter(store => storeTypes.includes(store.type.toLowerCase()));
    }
    if (county) {
        filteredStores = filteredStores.filter(store => store.county === county);
    }
    if (district) {
        filteredStores = filteredStores.filter(store => store.district === district);
    }
    displayStores(filteredStores);
    const offcanvasElement = document.getElementById('offcanvasNavbar');
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasElement) || new bootstrap.Offcanvas(offcanvasElement);
    bsOffcanvas.hide();
    saveStateToStorage();  // 自動儲存
}

function resetFilters() {
    document.querySelectorAll('input[name="store-type"]').forEach(checkbox => checkbox.checked = false);
    document.getElementById('county').value = '';
    document.getElementById('district').innerHTML = '<option value="">選擇鄉鎮市區</option>';
    populateCounties();
    displayStores(stores);
    saveStateToStorage();  // 自動儲存
}

function filterMultiStores() {
    const accordionDiv = document.getElementById('multiFilterAccordion');
    const storeTypes = Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(input => input.value);
    let filteredStores = stores;
    if (storeTypes.length > 0) {
        filteredStores = filteredStores.filter(store => storeTypes.includes(store.type.toLowerCase()));
    }
    const selectedDistricts = [];
    accordionDiv.querySelectorAll('.accordion-body').forEach(body => {
        if (body.classList.contains('checkbox-group')) {
            const county = body.parentElement.previousElementSibling.querySelector('.county-checkbox input').value;
            const checkedDistricts = Array.from(body.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
            checkedDistricts.forEach(district => selectedDistricts.push({ county, district }));
        } else {
            const direction = body.parentElement.previousElementSibling.querySelector('.accordion-button').textContent.trim();
            const checkedCounties = Array.from(body.querySelectorAll('.county-checkbox input[type="checkbox"]:checked')).map(input => input.value);
            if (checkedCounties.length > 0) {
                checkedCounties.forEach(county => {
                    const districts = [...new Set(filteredStores.filter(store => store.county === county).map(store => store.district))].sort();
                    districts.forEach(district => selectedDistricts.push({ county, district }));
                });
            } else {
                const directionCounties = body.querySelectorAll('.county-checkbox input[type="checkbox"]');
                const allChecked = Array.from(directionCounties).every(cb => cb.checked);
                if (allChecked) {
                    const directionDistricts = [...new Set(filteredStores.filter(store => store.direction === direction).map(store => store.district))].sort();
                    filteredStores.filter(store => store.direction === direction).forEach(store => {
                        directionDistricts.forEach(district => selectedDistricts.push({ county: store.county, district }));
                    });
                }
            }
        }
    });
    if (selectedDistricts.length > 0) {
        filteredStores = filteredStores.filter(store => {
            return selectedDistricts.some(item => item.county === store.county && item.district === store.district);
        });
    }
    displayStores(filteredStores);
    const offcanvasElement = document.getElementById('offcanvasNavbar');
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasElement) || new bootstrap.Offcanvas(offcanvasElement);
    bsOffcanvas.hide();
    saveStateToStorage();  // 自動儲存
}

function resetMultiFilters() {
    document.querySelectorAll('input[name="multi-store-type"]').forEach(checkbox => checkbox.checked = false);
    const accordionDiv = document.getElementById('multiFilterAccordion');
    accordionDiv.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = false);
    populateMultiFilterAccordion();
    displayStores(stores);
    saveStateToStorage();  // 自動儲存
}

function locateUser() {
    locateControl.start();
}

function navigate(address, mapType) {
    let url;
    if (mapType === 'google') {
        url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    } else if (mapType === 'apple') {
        url = `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`;
    }
    window.open(url, '_blank');
}

function navigateFromUser(mapType) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                let url;
                if (mapType === 'google') {
                    url = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${encodeURIComponent(stores[0].address)}`;
                } else if (mapType === 'apple') {
                    url = `https://maps.apple.com/?saddr=${lat},${lng}&daddr=${encodeURIComponent(stores[0].address)}`;
                }
                window.open(url, '_blank');
            },
            error => console.error("無法獲取您的位置：" + error.message)
        );
    }
}

function toggleFilters() {
    const offcanvasElement = document.getElementById('offcanvasNavbar');
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasElement) || new bootstrap.Offcanvas(offcanvasElement);
    bsOffcanvas.toggle();
}

// === LocalStorage 功能 ===

// 儲存目前所有狀態
function saveStateToStorage() {
    const state = {
        [STORAGE_KEYS.MARKER_CLUSTER]: isMarkerClusterEnabled,
        [STORAGE_KEYS.FILTER_TAB]: document.querySelector('#filterTabs .nav-link.active')?.id || 'filter-tab',
        [STORAGE_KEYS.FILTER_STORE_TYPES]: Array.from(document.querySelectorAll('input[name="store-type"]:checked')).map(i => i.value),
        [STORAGE_KEYS.FILTER_COUNTY]: document.getElementById('county').value,
        [STORAGE_KEYS.FILTER_DISTRICT]: document.getElementById('district').value,
        [STORAGE_KEYS.MULTI_STORE_TYPES]: Array.from(document.querySelectorAll('input[name="multi-store-type"]:checked')).map(i => i.value),
        [STORAGE_KEYS.MULTI_SELECTIONS]: getMultiFilterSelections()
    };
    localStorage.setItem('storeMapState', JSON.stringify(state));
}

// 取得多重篩選完整狀態
function getMultiFilterSelections() {
    const selections = {};
    document.querySelectorAll('#multiFilterAccordion > .accordion-item').forEach(item => {
        const directionBtn = item.querySelector('.accordion-button');
        const direction = directionBtn.textContent.trim();
        selections[direction] = { counties: {}, allCountiesChecked: false };

        const countyCheckboxes = item.querySelectorAll('.county-checkbox input[type="checkbox"]');
        const allChecked = Array.from(countyCheckboxes).every(cb => cb.checked);
        selections[direction].allCountiesChecked = allChecked;

        countyCheckboxes.forEach(cb => {
            const county = cb.value;
            const checked = cb.checked;
            selections[direction].counties[county] = { checked, districts: [], allDistrictsChecked: false };

            if (checked || allChecked) {
                const districtBody = cb.closest('.accordion-item').querySelector('.checkbox-group');
                if (districtBody) {
                    const checkedDistricts = Array.from(districtBody.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
                    const allDistricts = Array.from(districtBody.querySelectorAll('input[type="checkbox"]')).map(i => i.value);
                    const allDistrictChecked = checkedDistricts.length === allDistricts.length && allDistricts.length > 0;
                    selections[direction].counties[county].allDistrictsChecked = allDistrictChecked;
                    selections[direction].counties[county].districts = allDistrictChecked ? allDistricts : checkedDistricts;
                }
            }
        });
    });
    return selections;
}

// 從 LocalStorage 載入狀態
function loadStateFromStorage() {
    const saved = localStorage.getItem('storeMapState');
    if (!saved) return;

    try {
        const state = JSON.parse(saved);

        // 標記叢集
        if (state[STORAGE_KEYS.MARKER_CLUSTER] !== undefined) {
            isMarkerClusterEnabled = state[STORAGE_KEYS.MARKER_CLUSTER];
            const switchEl = document.getElementById('markerClusterSwitch');
            if (switchEl) switchEl.checked = isMarkerClusterEnabled;
        }

        // 切換分頁
        if (state[STORAGE_KEYS.FILTER_TAB]) {
            const tabBtn = document.getElementById(state[STORAGE_KEYS.FILTER_TAB]);
            if (tabBtn) {
                const bsTab = new bootstrap.Tab(tabBtn);
                bsTab.show();
            }
        }

        // 單一篩選
        if (state[STORAGE_KEYS.FILTER_STORE_TYPES]) {
            document.querySelectorAll('input[name="store-type"]').forEach(cb => {
                cb.checked = state[STORAGE_KEYS.FILTER_STORE_TYPES].includes(cb.value);
            });
            populateCounties();
            if (state[STORAGE_KEYS.FILTER_COUNTY]) {
                const countyEl = document.getElementById('county');
                countyEl.value = state[STORAGE_KEYS.FILTER_COUNTY];
                updateDistricts();
                if (state[STORAGE_KEYS.FILTER_DISTRICT]) {
                    document.getElementById('district').value = state[STORAGE_KEYS.FILTER_DISTRICT];
                }
            }
        }

        // 多重篩選
        if (state[STORAGE_KEYS.MULTI_STORE_TYPES]) {
            document.querySelectorAll('input[name="multi-store-type"]').forEach(cb => {
                cb.checked = state[STORAGE_KEYS.MULTI_STORE_TYPES].includes(cb.value);
            });
            populateMultiFilterAccordion();
            setTimeout(() => restoreMultiFilterSelections(state[STORAGE_KEYS.MULTI_SELECTIONS]), 100);
        }

        // 最後顯示結果
        setTimeout(() => {
            const activeTab = document.querySelector('#filterTabs .nav-link.active').id;
            if (activeTab === 'filter-tab') {
                filterStores();
            } else if (activeTab === 'multi-filter-tab') {
                filterMultiStores();
            } else {
                displayStores(stores);
            }
        }, 200);

    } catch (e) {
        console.error("載入儲存狀態失敗", e);
    }
}

// 恢復多重篩選勾選
function restoreMultiFilterSelections(selections) {
    if (!selections) return;
    document.querySelectorAll('#multiFilterAccordion > .accordion-item').forEach(item => {
        const directionBtn = item.querySelector('.accordion-button');
        const direction = directionBtn.textContent.trim();
        const dirData = selections[direction];
        if (!dirData) return;

        Object.keys(dirData.counties).forEach(county => {
            const countyCb = item.querySelector(`.county-checkbox input[value="${county}"]`);
            if (countyCb) {
                const countyData = dirData.counties[county];
                countyCb.checked = countyData.checked || dirData.allCountiesChecked;

                if (countyCb.checked) {
                    const collapseId = countyCb.closest('.accordion-header').getAttribute('id').replace('heading', 'collapse');
                    const collapseEl = document.getElementById(collapseId);
                    if (collapseEl) {
                        const bsCollapse = new bootstrap.Collapse(collapseEl, { toggle: false });
                        bsCollapse.show();
                    }
                }

                const districtBody = countyCb.closest('.accordion-item').querySelector('.checkbox-group');
                if (districtBody && (countyData.checked || dirData.allCountiesChecked)) {
                    const allDistricts = Array.from(districtBody.querySelectorAll('input[type="checkbox"]'));
                    if (countyData.allDistrictsChecked) {
                        allDistricts.forEach(d => d.checked = true);
                    } else {
                        allDistricts.forEach(d => {
                            d.checked = countyData.districts.includes(d.value);
                        });
                    }
                }
            }
        });
    });
}

// 清除所有儲存紀錄
function clearSavedState() {
    if (confirm('確定要清除所有操作紀錄？')) {
        localStorage.removeItem('storeMapState');
        location.reload();
    }
}

// 分頁切換時儲存
document.querySelectorAll('#filterTabs .nav-link').forEach(tab => {
    tab.addEventListener('shown.bs.tab', () => {
        saveStateToStorage();
    });
});

document.addEventListener('DOMContentLoaded', () => {
    initMap();
});