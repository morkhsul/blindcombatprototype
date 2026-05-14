// gui.js
export function createSettingsGUI(preset, container, onChange) {
  container.innerHTML = '';

  // ── helpers ──
  function addSlider(label, obj, prop, min, max, step) {
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '10px';

    const value = obj[prop] ?? 0;

    const lbl = document.createElement('label');
    lbl.style.display = 'block';
    lbl.textContent = `${label}: ${Number.isInteger(value) ? value : value.toFixed(2)}`;
    wrapper.appendChild(lbl);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step || 0.01;
    slider.value = value;
    slider.addEventListener('input', () => {
      const val = Number(slider.value);
      obj[prop] = step === 1 ? Math.round(val) : val;
      lbl.textContent = `${label}: ${Number.isInteger(obj[prop]) ? obj[prop] : obj[prop].toFixed(2)}`;
      onChange(preset);
    });
    wrapper.appendChild(slider);
    container.appendChild(wrapper);
  }

  function addCheckbox(label, obj, prop) {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'block';
    wrapper.style.marginBottom = '6px';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = obj[prop];
    box.addEventListener('change', () => {
      obj[prop] = box.checked;
      onChange(preset);
    });
    wrapper.appendChild(box);
    wrapper.appendChild(document.createTextNode(' ' + label));
    container.appendChild(wrapper);
  }

  function addDropdown(label, obj, prop, options, onOptionChange) {
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '10px';
    const lbl = document.createElement('label');
    lbl.textContent = label + ': ';
    const select = document.createElement('select');
    options.forEach((text, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = text;
      select.appendChild(opt);
    });
    select.value = obj[prop];
    select.addEventListener('change', () => {
      obj[prop] = Number(select.value);
      if (onOptionChange) onOptionChange(obj[prop]);
      onChange(preset);
    });
    lbl.appendChild(select);
    wrapper.appendChild(lbl);
    container.appendChild(wrapper);
  }

  // ── sections ──

  // Bloom
  const bloomTitle = document.createElement('h4');
  bloomTitle.textContent = 'Bloom';
  container.appendChild(bloomTitle);
  addSlider('Strength', preset.bloom, 'strength', 0, 3, 0.1);
  addSlider('Threshold', preset.bloom, 'threshold', 0, 1, 0.01);
  addSlider('Smoothing', preset.bloom, 'smoothing', 0, 1, 0.01);
  addCheckbox('Mipmap Blur', preset.bloom, 'mipmapBlur');
  addSlider('Radius', preset.bloom, 'radius', 0, 1, 0.01);
  addSlider('Levels', preset.bloom, 'levels', 1, 8, 1);

  // Color
  const colorTitle = document.createElement('h4');
  colorTitle.textContent = 'Color';
  container.appendChild(colorTitle);
  addSlider('Brightness', preset.color, 'brightness', -1, 1, 0.01);
  addSlider('Contrast', preset.color, 'contrast', -1, 1, 0.01);
  addSlider('Saturation', preset.color, 'saturation', -1, 1, 0.01);
  addSlider('Hue (°)', preset.color, 'hue', -180, 180, 1);

  // Vignette
  const vigTitle = document.createElement('h4');
  vigTitle.textContent = 'Vignette';
  container.appendChild(vigTitle);
  addCheckbox('Enabled', preset.vignette, 'enabled');
  addDropdown('Technique', preset.vignette, 'technique', ['Default', 'Eskil']);
  addSlider('Offset', preset.vignette, 'offset', 0, 1, 0.01);
  addSlider('Darkness', preset.vignette, 'darkness', 0, 1, 0.01);

  // Film Grain
  const filmTitle = document.createElement('h4');
  filmTitle.textContent = 'Film Grain';
  container.appendChild(filmTitle);
  addCheckbox('Enabled', preset.filmGrain, 'enabled');
  addSlider('Intensity', preset.filmGrain, 'intensity', 0, 1, 0.01);
  addCheckbox('Pre‑multiply', preset.filmGrain, 'premultiply');

  // DOF
  const dofTitle = document.createElement('h4');
  dofTitle.textContent = 'Depth of Field';
  container.appendChild(dofTitle);
  addCheckbox('Enabled', preset.dof, 'enabled');
  addSlider('Focus Distance', preset.dof, 'focus', 0.5, 100, 0.5);
  addSlider('Focus Range', preset.dof, 'focusRange', 0.1, 10, 0.1);
  addSlider('Bokeh Scale', preset.dof, 'bokehScale', 0, 5, 0.1);
  addSlider('Resolution Scale', preset.dof, 'resolutionScale', 0.25, 1, 0.05);

  // SMAA
  const smaaTitle = document.createElement('h4');
  smaaTitle.textContent = 'SMAA';
  container.appendChild(smaaTitle);
  addCheckbox('Enabled', preset.smaa, 'enabled');
  addDropdown('Quality Preset', preset.smaa, 'preset', [
    'Low',
    'Medium',
    'High',
    'Ultra'
  ]);
  addSlider(
    'Edge Threshold',
    preset.smaa,
    'edgeDetectionThreshold',
    0,
    0.5,
    0.01
  );
  addSlider(
    'Contrast Adapt.',
    preset.smaa,
    'localContrastAdaptationFactor',
    0,
    10,
    0.1
  );
  addSlider(
    'Orth. Steps',
    preset.smaa,
    'orthogonalSearchSteps',
    0,
    112,
    1
  );
  addSlider(
    'Diag. Steps',
    preset.smaa,
    'diagonalSearchSteps',
    0,
    20,
    1
  );
  addCheckbox('Diag. Detection', preset.smaa, 'diagonalDetection');
  addSlider(
    'Corner Round.',
    preset.smaa,
    'cornerRounding',
    0,
    100,
    1
  );
  addCheckbox('Corner Detection', preset.smaa, 'cornerDetection');

  // ── Copy / Import / Reset ──
  const buttonRow = document.createElement('div');
  buttonRow.style.marginTop = '15px';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Preset';
  copyBtn.addEventListener('click', () => {
    const json = JSON.stringify(preset, null, 2);
    navigator.clipboard.writeText(json).then(() => alert('Preset copied!'));
  });
  buttonRow.appendChild(copyBtn);

  const importBtn = document.createElement('button');
  importBtn.textContent = 'Import Preset';
  importBtn.addEventListener('click', () => {
    const json = prompt('Paste the preset JSON:');
    if (!json) return;
    try {
      const newPreset = JSON.parse(json);
      // sanitize imported preset
      if (newPreset.dof) {
        delete newPreset.dof.debugMode;
        delete newPreset.dof.aperture;
        delete newPreset.dof.maxblur;
      }
      if (newPreset.smaa) {
        delete newPreset.smaa.edgeDetectionMode;
        delete newPreset.smaa.predicationMode;
      }
      if (newPreset.filmGrain) {
        newPreset.filmGrain.premultiply = Boolean(newPreset.filmGrain.premultiply);
      }

      Object.assign(preset, newPreset);
      createSettingsGUI(preset, container, onChange);
      onChange(preset);
    } catch (e) {
      alert('Invalid JSON');
    }
  });
  buttonRow.appendChild(importBtn);

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset Default';
  resetBtn.addEventListener('click', () => {
    const defaultPreset = {
      bloom: {
        strength: 1.5,
        threshold: 0.6,
        smoothing: 0.4,
        mipmapBlur: true,
        radius: 0.85,
        levels: 8
      },
      color: {
        brightness: 0.0,
        contrast: 0.0,
        saturation: 0.0,
        hue: 0
      },
      vignette: {
        enabled: true,
        technique: 0,
        offset: 0.5,
        darkness: 0.5
      },
      filmGrain: {
        enabled: true,
        intensity: 0.05,
        premultiply: false
      },
      dof: {
        enabled: true,
        focus: 10.0,
        focusRange: 1.5,
        bokehScale: 1.0,
        resolutionScale: 0.5
      },
      smaa: {
        enabled: true,
        preset: 1,
        edgeDetectionThreshold: 0.1,
        localContrastAdaptationFactor: 2.0,
        orthogonalSearchSteps: 16,
        diagonalSearchSteps: 6,
        diagonalDetection: true,
        cornerRounding: 25,
        cornerDetection: true
      }
    };
    Object.assign(preset, defaultPreset);
    createSettingsGUI(preset, container, onChange);
    onChange(preset);
  });
  buttonRow.appendChild(resetBtn);

  container.appendChild(buttonRow);
}