let map;
let markers = L.markerClusterGroup();
let nonClusteredMarkers = L.layerGroup();
let isMarkerClusterEnabled = true;
let locateControl;
let stores = [];
let deferredPrompt;

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
            alert("無法獲取您的位置：" + err.message);
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
    } catch (error) {
        console.error(error);
        alert('載入店家資料失敗，請稍後再試');
    }
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
}

function handleCheckboxChange(event) {
    event.stopPropagation();
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
            let icon;
            switch (store.type.toLowerCase()) {
                case 'carrefour':
                case '家樂福':
                    icon = L.icon({
                        iconUrl: 'src/carrefour-logo.png',
                        iconSize: [40, 40],
                        iconAnchor: [20, 40],
                        popupAnchor: [0, -40]
                    });
                    break;
                case 'pxmart':
                case '全聯':
                    icon = L.icon({
                        iconUrl: 'src/pxmart-logo.png',
                        iconSize: [40, 40],
                        iconAnchor: [20, 40],
                        popupAnchor: [0, -40]
                    });
                    break;
                case 'rt-mart':
                case '大潤發':
                    icon = L.icon({
                        iconUrl: 'src/rtmart-logo.png',
                        iconSize: [40, 40],
                        iconAnchor: [20, 40],
                        popupAnchor: [0, -40]
                    });
                    break;
                case 'ssafe':
                case '大買家':
                    icon = L.icon({
                        iconUrl: 'src/ssafe-logo.png',
                        iconSize: [40, 40],
                        iconAnchor: [20, 40],
                        popupAnchor: [0, -40]
                    });
                    break;
                default:
                    icon = L.icon({
                        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                        iconSize: [25, 41],
                        iconAnchor: [12, 41],
                        popupAnchor: [0, -41]
                    });
            }
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
}

function resetFilters() {
    document.querySelectorAll('input[name="store-type"]').forEach(checkbox => checkbox.checked = false);
    document.getElementById('county').value = '';
    document.getElementById('district').innerHTML = '<option value="">選擇鄉鎮市區</option>';
    populateCounties();
    displayStores(stores);
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
                        directionDistricts.forERIC(district => selectedDistricts.push({ county: store.county, district }));
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
}

function resetMultiFilters() {
    document.querySelectorAll('input[name="multi-store-type"]').forEach(checkbox => checkbox.checked = false);
    const accordionDiv = document.getElementById('multiFilterAccordion');
    accordionDiv.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = false);
    populateMultiFilterAccordion();
    displayStores(stores);
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
            error => alert("無法獲取您的位置")
        );
    }
}

function toggleFilters() {
    const offcanvasElement = document.getElementById('offcanvasNavbar');
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasElement) || new bootstrap.Offcanvas(offcanvasElement);
    bsOffcanvas.toggle();
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
});