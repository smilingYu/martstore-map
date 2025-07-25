let map;
let markers = L.markerClusterGroup();
let circles = [];
let stores = [];

function initMap() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                map = L.map('map', {
                    zoomControl: false,
                    maxBoundsViscosity: 1.0
                }).setView([lat, lng], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }).addTo(map);
                map.setMaxBounds([[20, 118], [26, 124]]);
                map.addLayer(markers);

                // 清理舊的圓形
                circles.forEach(circle => map.removeLayer(circle));
                circles = [];

                const userIcon = L.icon({
                    iconUrl: 'user-location.png',
                    iconSize: [40, 40],
                    iconAnchor: [20, 40],
                    popupAnchor: [0, -40]
                });
                const userMarker = L.marker([lat, lng], { icon: userIcon })
                    .bindPopup("您的位置<br><button onclick=\"navigateFromUser('google')\">Google 導航</button><br><button onclick=\"navigateFromUser('apple')\">Apple Maps 導航</button>")
                    .openPopup();
                markers.addLayer(userMarker);

                // 添加新的圓形，確保中心點可見
                const circle = L.circle([lat, lng], {
                    color: '#3388ff',
                    fillColor: '#3388ff',
                    fillOpacity: 0.2,
                    weight: 2, // 增加邊界粗細
                    opacity: 1, // 確保邊界可見
                    radius: 1000
                }).addTo(map);
                circles.push(circle);

                loadStores();
            },
            error => {
                map = L.map('map', {
                    zoomControl: false,
                    maxBoundsViscosity: 1.0
                }).setView([23.5, 121], 8);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }).addTo(map);
                map.setMaxBounds([[20, 118], [26, 124]]);
                map.addLayer(markers);
                loadStores();
                alert("無法獲取您的位置，顯示預設視圖。");
            }
        );
    } else {
        map = L.map('map', {
            zoomControl: false,
            maxBoundsViscosity: 1.0
        }).setView([23.5, 121], 8);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        map.setMaxBounds([[20, 118], [26, 124]]);
        map.addLayer(markers);
        loadStores();
        alert("您的瀏覽器不支援地理定位，顯示預設視圖。");
    }
}

async function loadStores() {
    const response = await fetch('store_coordinates.json');
    stores = await response.json();
    populateCounties();
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
                    <b>${store.name}</b><br>
                    類型: ${store.type}<br>
                    地址: ${store.address}<br>
                    縣市: ${store.county}<br>
                    鄉鎮市區: ${store.district}<br>
                    <button onclick="navigate('${store.address}', 'google')">Google 導航</button><br>
                    <button onclick="navigate('${store.address}', 'apple')">Apple Maps 導航</button>
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
}

function resetFilters() {
    document.getElementById('county').value = '';
    document.getElementById('district').innerHTML = '<option value="">選擇鄉鎮市區</option>';
    displayStores(stores);
}

function locateUser() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                map.setView([lat, lng], 13);

                // 清理舊的圓形
                circles.forEach(circle => map.removeLayer(circle));
                circles = [];

                const userIcon = L.icon({
                    iconUrl: 'src/man.png',
                    iconSize: [40, 40],
                    iconAnchor: [20, 40],
                    popupAnchor: [0, -40]
                });
                const userMarker = L.marker([lat, lng], { icon: userIcon })
                    .bindPopup("您的位置<br><button onclick=\"navigateFromUser('google')\">Google 導航</button><br><button onclick=\"navigateFromUser('apple')\">Apple Maps 導航</button>")
                    .openPopup();
                markers.addLayer(userMarker);

                // 添加新的圓形，確保中心點可見
                const circle = L.circle([lat, lng], {
                    color: '#3388ff',
                    fillColor: '#3388ff',
                    fillOpacity: 0.2,
                    weight: 2,
                    opacity: 1,
                    radius: 1000
                }).addTo(map);
                circles.push(circle);
            },
            error => alert("無法獲取您的位置")
        );
    } else {
        alert("您的瀏覽器不支援地理定位");
    }
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
    const filterContainer = document.getElementById('filterContainer');
    const toggleIcon = document.querySelector('.toggle-icon');
    filterContainer.classList.toggle('active');
    toggleIcon.style.transform = filterContainer.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
});