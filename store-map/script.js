let map;
let markers = L.markerClusterGroup();
let locateControl;
let stores = [];

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

    // 初始化 leaflet-locatecontrol
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
}

async function loadStores() {
    const response = await fetch('store_coordinates.json');
    stores = await response.json();
    populateCounties();
    populateMultiFilterAccordion();
    displayStores(stores);
}

function populateCounties() {
    const countySelect = document.getElementById('county');
    const counties = [...new Set(stores.map(store => store.county))].sort();
    counties.forEach(county => {
        const option = document.createElement('option');
        option.value = county;
        option.textContent = county;
        countySelect.appendChild(option);
    });
}

function populateMultiFilterAccordion() {
    const accordionDiv = document.getElementById('multiFilterAccordion');
    const directions = [...new Set(stores.map(store => store.direction))].sort();
    accordionDiv.innerHTML = '';
    let index = 0;
    for (const direction of directions) {
        const counties = [...new Set(stores.filter(store => store.direction === direction).map(store => store.county))].sort();
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
                            const districts = [...new Set(stores.filter(store => store.county === county).map(store => store.district))].sort();
                            return `
                                <div class="accordion-item">
                                    <h2 class="accordion-header" id="headingCounty${index}-${counties.indexOf(county)}">
                                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseCounty${index}-${counties.indexOf(county)}" data-bs-allow-multiple="true" aria-expanded="false" aria-controls="collapseCounty${index}-${counties.indexOf(county)}">
                                            <input type="checkbox" name="county" value="${county}" onchange="handleCheckboxChange(event)"> ${county}
                                        </button>
                                    </h2>
                                    <div id="collapseCounty${index}-${counties.indexOf(county)}" class="accordion-collapse collapse" aria-labelledby="headingCounty${index}-${counties.indexOf(county)}">
                                        <div class="accordion-body checkbox-group">
                                            ${districts.map(district => `
                                                <label><input type="checkbox" name="district-${county}" value="${district}" onchange="handleCheckboxChange(event)"> ${district}</label><br>
                                            `).join('')}
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

function handleCheckboxChange(event) {
    // 防止 Checkbox 勾選時自動展開
    event.stopPropagation();
}

function updateDistricts() {
    const countySelect = document.getElementById('county');
    const districtSelect = document.getElementById('district');
    districtSelect.innerHTML = '<option value="">選擇鄉鎮市區</option>';
    const selectedCounty = countySelect.value;
    if (selectedCounty) {
        const districts = [...new Set(stores.filter(store => store.county === selectedCounty).map(store => store.district))].sort();
        districts.forEach(district => {
            const option = document.createElement('option');
            option.value = district;
            option.textContent = district;
            districtSelect.appendChild(option);
        });
    }
}

function displayStores(storesToDisplay) {
    markers.clearLayers();
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
            markers.addLayer(marker);
        }
    });
    if (storesToDisplay.length > 0) {
        const group = new L.featureGroup(markers.getLayers());
        map.fitBounds(group.getBounds(), { padding: [0, 0] });
    }
}

function filterStores() {
    const county = document.getElementById('county').value;
    const district = document.getElementById('district').value;
    let filteredStores = stores;
    if (county) {
        filteredStores = filteredStores.filter(store => store.county === county);
    }
    if (district) {
        filteredStores = filteredStores.filter(store => store.district === district);
    }
    displayStores(filteredStores);
    // 關閉 Offcanvas
    const offcanvasElement = document.getElementById('offcanvasNavbar');
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasElement) || new bootstrap.Offcanvas(offcanvasElement);
    bsOffcanvas.hide();
}

function resetFilters() {
    document.getElementById('county').value = '';
    document.getElementById('district').innerHTML = '<option value="">選擇鄉鎮市區</option>';
    displayStores(stores);
}

function filterMultiStores() {
    const accordionDiv = document.getElementById('multiFilterAccordion');
    let filteredStores = stores;
    const selectedDistricts = [];
    accordionDiv.querySelectorAll('.accordion-body').forEach(body => {
        if (body.classList.contains('checkbox-group')) {
            const county = body.parentElement.previousElementSibling.querySelector('.accordion-button input').value;
            const checkedDistricts = Array.from(body.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
            checkedDistricts.forEach(district => selectedDistricts.push({ county, district }));
        } else {
            const direction = body.parentElement.previousElementSibling.querySelector('.accordion-button').textContent.trim();
            const checkedCounties = Array.from(body.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
            if (checkedCounties.length > 0) {
                checkedCounties.forEach(county => {
                    const districts = [...new Set(stores.filter(store => store.county === county).map(store => store.district))].sort();
                    districts.forEach(district => selectedDistricts.push({ county, district }));
                });
            } else {
                const directionCounties = body.querySelectorAll('input[type="checkbox"]');
                const allChecked = Array.from(directionCounties).every(cb => cb.checked);
                if (allChecked) {
                    const directionDistricts = [...new Set(stores.filter(store => store.direction === direction).map(store => store.district))].sort();
                    stores.filter(store => store.direction === direction).forEach(store => {
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
    // 關閉 Offcanvas
    const offcanvasElement = document.getElementById('offcanvasNavbar');
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasElement) || new bootstrap.Offcanvas(offcanvasElement);
    bsOffcanvas.hide();
}

function resetMultiFilters() {
    const accordionDiv = document.getElementById('multiFilterAccordion');
    accordionDiv.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = false);
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