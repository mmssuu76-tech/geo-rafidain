(() => {
  const root = document.querySelector('#study-map-field');
  if (!root) return;

  const svg = document.querySelector('#study-map');
  const layer = document.querySelector('#study-map-layers');
  const select = document.querySelector('#governorate-select');
  const areaInput = document.querySelector('#study-area-input');
  const selectedLabel = document.querySelector('#selected-governorate');
  const hoverLabel = document.querySelector('#study-map-hover');
  const status = document.querySelector('#study-map-status');
  const clearButton = document.querySelector('#clear-governorate');
  const form = document.querySelector('#project-form');
  const namespace = 'http://www.w3.org/2000/svg';
  const mapWidth = 620;
  const mapHeight = 650;
  const padding = 30;
  let selectedName = '';
  let paths = [];

  const coordinatePairs = function* (value) {
    if (Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)) {
      yield [value[0], value[1]];
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) yield* coordinatePairs(item);
    }
  };

  const geometryPath = (geometry, project) => {
    const polygons = geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];

    return polygons.map(polygon => polygon.map(ring => {
      const points = ring.map(project);
      if (!points.length) return '';
      return `M${points.map(point => `${point[0]},${point[1]}`).join('L')}Z`;
    }).join('')).join('');
  };

  const detailWithoutSelectedPrefix = () => {
    const value = areaInput.value.trim();
    if (!selectedName || !value.startsWith(selectedName)) return value;
    return value.slice(selectedName.length).replace(/^\s*[—–-]\s*/, '').trim();
  };

  const chooseGovernorate = (name, updateInput = true) => {
    const detail = detailWithoutSelectedPrefix();
    selectedName = name;
    selectedLabel.textContent = name || 'لم تُحدد بعد';
    hoverLabel.textContent = name || 'مرّر المؤشر فوق المحافظة';
    clearButton.hidden = !name;
    select.value = name;

    paths.forEach(path => {
      const active = path.dataset.name === name;
      path.classList.toggle('selected', active);
      path.setAttribute('aria-pressed', String(active));
    });

    if (updateInput) {
      areaInput.value = name ? (detail ? `${name} — ${detail}` : name) : detail;
      areaInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  const createMap = data => {
    const features = data.features || [];
    const allPoints = features.flatMap(feature => [...coordinatePairs(feature.geometry.coordinates)]);
    if (!allPoints.length) throw new Error('EMPTY_GEOMETRY');

    const longitudes = allPoints.map(point => point[0]);
    const latitudes = allPoints.map(point => point[1]);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    const longitudeScale = Math.cos(((minLatitude + maxLatitude) / 2) * Math.PI / 180);
    const geographicWidth = (maxLongitude - minLongitude) * longitudeScale;
    const geographicHeight = maxLatitude - minLatitude;
    const scale = Math.min(
      (mapWidth - padding * 2) / geographicWidth,
      (mapHeight - padding * 2) / geographicHeight
    );
    const offsetX = (mapWidth - geographicWidth * scale) / 2;
    const offsetY = (mapHeight - geographicHeight * scale) / 2;
    const project = coordinate => [
      (offsetX + (coordinate[0] - minLongitude) * longitudeScale * scale).toFixed(1),
      (offsetY + (maxLatitude - coordinate[1]) * scale).toFixed(1)
    ];

    const sortedFeatures = [...features].sort((a, b) =>
      a.properties.name.localeCompare(b.properties.name, 'ar'));

    sortedFeatures.forEach(feature => {
      const name = feature.properties.name;
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.append(option);

      const path = document.createElementNS(namespace, 'path');
      path.setAttribute('d', geometryPath(feature.geometry, project));
      path.setAttribute('class', 'governorate-shape');
      path.setAttribute('role', 'button');
      path.setAttribute('tabindex', '0');
      path.setAttribute('aria-label', `اختيار ${name}`);
      path.setAttribute('aria-pressed', 'false');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.dataset.name = name;
      path.addEventListener('click', () => chooseGovernorate(name));
      path.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          chooseGovernorate(name);
        }
      });
      path.addEventListener('pointerenter', () => { hoverLabel.textContent = name; });
      path.addEventListener('pointerleave', () => {
        hoverLabel.textContent = selectedName || 'مرّر المؤشر فوق المحافظة';
      });
      layer.append(path);
    });

    paths = [...layer.querySelectorAll('.governorate-shape')];
    status.textContent = 'اختر المحافظة بالنقر على الخريطة.';
    root.classList.add('map-ready');
  };

  select.addEventListener('change', () => chooseGovernorate(select.value));
  clearButton.addEventListener('click', () => chooseGovernorate(''));
  form.addEventListener('reset', () => setTimeout(() => chooseGovernorate('', false), 0));

  fetch('assets/iraq-governorates.geojson', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return response.json();
    })
    .then(createMap)
    .catch(() => {
      status.textContent = 'تعذر تحميل الخريطة. يمكنك كتابة منطقة الدراسة يدويًا.';
      root.classList.add('map-error');
      svg.hidden = true;
      hoverLabel.hidden = true;
    });
})();
