
/* ===============================================
         CONFIGURAÇÕES E CONSTANTES =============================================== */
const CONFIG = {
    POPUP_CLOSE_DELAY: 500,
    PLACEHOLDER_SVG: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500">
    <rect width="100%" height="100%" fill="#08080c"/>
    <text x="50%" y="50%" fill="#333" text-anchor="middle" dominant-baseline="middle" font-size="70">◈</text>
</svg>    
    `)
};

const MENU_ATTRIBUTES_MAP = {
    potencia: 'POT',
    reflexo: 'REF',
    precisao: 'PRE',
    intelecto: 'INT',
    instinto: 'INS'
};

const ESTADOS_DISPONIVEIS = ["normal", "sangrando", "quebrado", "decepado"];

/* ===============================================
       FUNÇÕES UTILITÁRIAS DE SUPORTE =============================================== */
function escapeHTML(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function comprimirImagem(file, maxSize = 300, quality = 0.7) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve('');
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const width = Math.max(1, Math.round(img.width * scale));
                const height = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/png', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function createResourceBarHTML(current, max, resourceType = 'pv') {
    const safeMax = max > 0 ? max : 1;
    const percentage = Math.max(0, Math.min(100, (current / safeMax) * 100));
    const isLow = percentage <= 33.333;
    const fillClass = resourceType === 'pe'
        ? `pe-fill ${percentage > 66.666 ? 'full' : percentage > 33.333 ? 'medium' : 'low'}`
        : `hp-fill${isLow && current > 0 ? ' low' : ''}`;
    return `<div class="${fillClass}" style="width: ${percentage}%"></div><span class="hp-text">${current}/${max}</span>`;
}

/* ===============================================
         GERENCIADOR DO INVENTÁRIO =============================================== */
const InventorySystem = (() => {
    let items = [];
    let lastPopupOpenedAt = 0;
    let currentViewerIndex = -1;

    let canvas, equipped, equippedList, counter, importBtn, importInput, viewerOverlay, viewerDeleteButton;

    function init() {
        canvas = document.getElementById("canvas");
        equipped = document.getElementById("equipped");
        equippedList = document.getElementById("equippedList");
        counter = document.getElementById("counter");
        importBtn = document.getElementById("importBtn");
        importInput = document.getElementById("importInput");
        viewerOverlay = document.getElementById("viewerOverlay");
        viewerDeleteButton = document.getElementById("viewerDeleteButton");

        if (!canvas) return;
        bindEvents();
        render();
    }

    function bindEvents() {
        if (importBtn && importInput) {
            importBtn.classList.remove("hidden");
            importBtn.addEventListener("click", () => importInput.click());
            importInput.addEventListener("change", handleImportFiles);
        }

        if (viewerOverlay) {
            viewerOverlay.addEventListener("click", (e) => {
                if (e.target === viewerOverlay) closeViewer();
            });
        }

        viewerDeleteButton?.addEventListener("click", deleteCurrentItem);

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && viewerOverlay?.classList.contains("show")) {
                closeViewer();
            }
        });
    }

    function updateCounter() {
        if (!counter) return;
        const equippedCount = items.filter(item => item.equipped).length;
        counter.textContent = String(equippedCount);
        counter.title = `Itens equipados: ${equippedCount}.`;
        counter.classList.remove("over-capacity");
    }

    function findPosition() {
        const size = 110;
        const width = canvas.clientWidth || 500;
        const height = canvas.clientHeight || 500;

        for (let y = 20; y < height - 70; y += size) {
            for (let x = 20; x < width - 70; x += size) {
                const occupied = items.some(item => {
                    if (item.equipped) return false;
                    const ix = Number(item.x) || 0;
                    const iy = Number(item.y) || 0;
                    return Math.abs(ix - x) < 70 && Math.abs(iy - y) < 70;
                });
                if (!occupied) return {x, y};
            }
        }
        return {x: 20, y: 20};
    }

    function handleImportFiles(e) {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    const importedItems = Array.isArray(data) ? data : [data];

                    importedItems.forEach(itemData => {
                        if (itemData && itemData.name) {
                            const pos = findPosition();
                            items.push({
                                ...itemData,
                                id: Date.now() + "_" + Math.random().toString(36).slice(2),
                                x: pos.x,
                                y: pos.y,
                                equipped: false
                            });
                        }
                    });
                    render();
                    if (typeof AutoSaveSystem !== 'undefined') AutoSaveSystem.requestSave();
                } catch (err) {
                    console.error("Erro ao importar o arquivo:", file.name, err);
                }
            };
            reader.readAsText(file);
        });
        importInput.value = "";
    }

    function addItemQuantityIndicator(element, item) {
        if (item.type === "proteção") {
            const protection = Math.max(0, Math.floor(Number(item.protection) || 0));
            const indicator = document.createElement("div");
            indicator.className = "item-protection-indicator";
            indicator.setAttribute("aria-label", `Proteção ${protection}`);
            indicator.innerHTML = `
        <svg viewBox="0 0 32 36" aria-hidden="true">
            <path d="M16 1.8L29 6.2V16.5C29 25.1 23.9 31.8 16 34.3C8.1 31.8 3 25.1 3 16.5V6.2L16 1.8Z" fill="#fff"/>
        </svg>
        <span class="item-protection-value">${protection}</span>
    `;
            element.appendChild(indicator);
            return;
        }

        if (item.type !== "espolio" && item.type !== "armamento") return;

        const indicator = document.createElement("div");
        indicator.className = "item-quantity-indicator";

        if (item.type === "espolio") {
            const quantity = Math.max(0, Number(item.quantity) || 0);
            indicator.innerHTML = `<span class="item-loot-quantity">${quantity}x</span>`;
        } else {
            const current = Math.max(0, Number(item.ammoCurrent) || 0);
            const max = Math.max(0, Number(item.ammoMax) || 0);
            indicator.innerHTML = `
        <span class="item-ammo-current">${Math.min(current, max)}</span>
        <span class="item-ammo-slash">/</span>
        <span class="item-ammo-max">${max}</span>`;
        }
        element.appendChild(indicator);
    }

    function render() {
        renderCanvas();
        renderEquipped();
        updateCounter();
    }

    function renderCanvas() {
        if (!canvas) return;
        canvas.innerHTML = "";

        items.forEach((item, index) => {
            if (item.equipped) return;

            const element = document.createElement("div");
            element.className = "canvas-item";
            element.dataset.index = index;
            element.style.left = (Number(item.x) || 20) + "px";
            element.style.top = (Number(item.y) || 20) + "px";

            const img = document.createElement("img");
            img.src = item.image || CONFIG.PLACEHOLDER_SVG;

            element.appendChild(img);
            addItemQuantityIndicator(element, item);
            canvas.appendChild(element);

            setupCanvasDrag(element, item, index);
        });
    }

    function setupCanvasDrag(element, item, index) {
        let startX = 0, startY = 0, originalX = 0, originalY = 0;
        let moved = false;

        element.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            startX = e.clientX;
            startY = e.clientY;
            originalX = Number(item.x) || 20;
            originalY = Number(item.y) || 20;
            moved = false;

            try {element.setPointerCapture(e.pointerId);} catch (_) { }
            element.classList.add("dragging");
        });

        element.addEventListener("pointermove", (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
            if (!moved) return;

            item.x = Math.max(0, Math.min(canvas.clientWidth - element.offsetWidth, originalX + dx));
            item.y = Math.max(0, Math.min(canvas.clientHeight - element.offsetHeight, originalY + dy));

            element.style.left = item.x + "px";
            element.style.top = item.y + "px";
        });

        element.addEventListener("pointerup", (e) => {
            element.classList.remove("dragging");
            const rect = equipped.getBoundingClientRect();
            const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom;

            if (moved && inside) {
                item.equipped = true;

                render();
                if (typeof AutoSaveSystem !== 'undefined') AutoSaveSystem.requestSave();
                return;
            }

            if (!moved) openViewer(index);
        });

        element.addEventListener("pointercancel", () => element.classList.remove("dragging"));
    }

    function renderEquipped() {
        if (!equippedList) return;
        equippedList.innerHTML = "";

        const equippedItems = items.filter(item => item.equipped);
        if (equippedItems.length === 0) {
            const empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = "Arraste itens para cá";
            equippedList.appendChild(empty);
            return;
        }

        items.forEach((item, index) => {
            if (!item.equipped) return;

            const element = document.createElement("div");
            element.className = "equipped-item";
            element.dataset.index = index;

            const img = document.createElement("img");
            img.src = item.image || CONFIG.PLACEHOLDER_SVG;

            element.appendChild(img);
            addItemQuantityIndicator(element, item);
            equippedList.appendChild(element);

            setupEquippedItem(element, item, index);
        });
    }

    function setupEquippedItem(element, item, index) {
        let startX = 0, startY = 0, lastY = 0;
        let direction = null, moved = false, pointerId = null;

        element.addEventListener("pointerdown", (e) => {
            startX = e.clientX;
            startY = e.clientY;
            lastY = e.clientY;
            pointerId = e.pointerId;
            direction = null;
            moved = false;
        });

        element.addEventListener("pointermove", (e) => {
            if (pointerId !== e.pointerId) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (!direction) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                if (Math.abs(dx) > Math.abs(dy)) {
                    direction = "horizontal";
                    moved = true;
                    return;
                }
                direction = "vertical";
                moved = true;
                element.classList.add("dragging");
                try {element.setPointerCapture(e.pointerId);} catch (_) { }
            }

            if (direction === "horizontal") return;

            if (direction === "vertical") {
                const rect = equipped.getBoundingClientRect();
                const canvasRect = canvas.getBoundingClientRect();

                if (e.clientY < rect.top || e.clientY > rect.bottom) {
                    item.equipped = false;
                    item.x = Math.max(0, e.clientX - canvasRect.left - 40);
                    item.y = Math.max(0, e.clientY - canvasRect.top - 40);
                    render();
                    if (typeof AutoSaveSystem !== 'undefined') AutoSaveSystem.requestSave();
                    pointerId = null;
                    return;
                }

                element.style.transform = `translateY(${e.clientY - lastY}px)`;
                lastY = e.clientY;
            }
        });

        element.addEventListener("pointerup", (e) => {
            element.style.transform = "";
            element.classList.remove("dragging");

            if (!moved) openViewer(index);

            pointerId = null;
            try {element.releasePointerCapture(e.pointerId);} catch (_) { }
        });

        element.addEventListener("pointercancel", () => {
            element.style.transform = "";
            element.classList.remove("dragging");
            pointerId = null;
        });
    }

    function openViewer(index) {
        const item = items[index];
        if (!item || !viewerOverlay) return;

        currentViewerIndex = index;

        const viewerBox = viewerOverlay.querySelector(".viewer-box");
        viewerBox.classList.toggle("equipavel-viewer", item.type === "equipavel");
        document.getElementById("viewerImg").src = item.image || CONFIG.PLACEHOLDER_SVG;
        document.getElementById("viewerName").textContent = item.name || "";

        const viewerStats = document.getElementById("viewerStats");
        viewerStats.innerHTML = "";

        if (item.type === "proteção") {
            const protection = Math.max(0, Number(item.protection) || 0);
            viewerStats.innerHTML = `
        <div class="viewer-value-row">
            <div>
                <div class="viewer-value-label">PROTEÇÃO</div>
                <div class="viewer-protection-value">
                    <svg viewBox="0 0 64 72" aria-hidden="true">
                        <path d="M32 3.5L58 12.3V33C58 50.2 47.8 63.6 32 68.7C16.2 63.6 6 50.2 6 33V12.3L32 3.5Z" fill="#fff"/>
                    </svg>
                    <span id="viewerProtectionValue">${protection}</span>
                </div>
            </div>
        </div>`;
        } else if (item.type === "espolio") {
            const quantity = Math.max(0, Number(item.quantity) || 0);
            viewerStats.innerHTML = `
        <div class="viewer-value-row">
            <div>
                <div class="viewer-value-label">QUANTIDADE</div>
                <div id="viewerQuantityValue" class="viewer-value-number">${quantity}</div>
            </div>
            <div class="viewer-counter">
                <button id="viewerQuantityMinus" class="control-button" type="button" aria-label="Diminuir quantidade">-</button>
                <button id="viewerQuantityPlus" class="control-button" type="button" aria-label="Aumentar quantidade">+</button>
            </div>
        </div>`;

            const updateQuantity = (val) => {
                val = Math.max(0, Math.floor(Number(val) || 0));
                item.quantity = val;
                document.getElementById("viewerQuantityValue").textContent = val;
                if (typeof AutoSaveSystem !== 'undefined') AutoSaveSystem.schedule(100);
            };

            document.getElementById("viewerQuantityMinus").addEventListener("click", () => updateQuantity(item.quantity - 1));
            document.getElementById("viewerQuantityPlus").addEventListener("click", () => updateQuantity(item.quantity + 1));
        } else if (item.type === "armamento") {
            const current = Math.max(0, Number(item.ammoCurrent) || 0);
            const max = Math.max(0, Number(item.ammoMax) || 0);
            const safeCurrent = Math.min(current, max);
            const segmentCount = Math.min(Math.max(max, 1), 30);

            let segments = "";
            for (let i = 0; i < segmentCount; i++) {
                const segmentValue = ((i + 1) / segmentCount) * max;
                segments += `<div class="viewer-ammo-segment ${safeCurrent >= segmentValue ? "active" : ""}"></div>`;
            }

            viewerStats.innerHTML = `
        <div class="viewer-ammo-box">
            <div class="viewer-ammo-top">
                <div class="viewer-ammo-text">
                    <span id="viewerAmmoCurrent" class="viewer-ammo-current">${safeCurrent}</span>
                    <span class="viewer-ammo-separator">/</span>
                    <span class="viewer-ammo-max">${max}</span>
                </div>
                <div class="viewer-counter">
                    <button id="viewerAmmoMinus" class="control-button" type="button" aria-label="Diminuir munição">-</button>
                    <button id="viewerAmmoPlus" class="control-button" type="button" aria-label="Aumentar munição">+</button>
                </div>
            </div>
            <div id="viewerAmmoBar" class="viewer-ammo-bar" aria-label="Munição">${segments}</div>
        </div>`;

            const updateAmmo = (val) => {
                val = Math.min(Math.max(0, Math.floor(Number(val) || 0)), max);
                item.ammoCurrent = val;
                document.getElementById("viewerAmmoCurrent").textContent = val;
                if (typeof AutoSaveSystem !== 'undefined') AutoSaveSystem.schedule(100);
                document.querySelectorAll("#viewerAmmoBar .viewer-ammo-segment").forEach((seg, idx) => {
                    seg.classList.toggle("active", val >= ((idx + 1) / segmentCount) * max);
                });
            };

            document.getElementById("viewerAmmoMinus").addEventListener("click", () => updateAmmo(item.ammoCurrent - 1));
            document.getElementById("viewerAmmoPlus").addEventListener("click", () => updateAmmo(item.ammoCurrent + 1));
        }

        document.getElementById("viewerDescription").textContent = item.description || "";
        lastPopupOpenedAt = Date.now();
        viewerOverlay.classList.add("show");
    }

    function deleteCurrentItem() {
        if (currentViewerIndex < 0 || currentViewerIndex >= items.length) return;
        if (Date.now() - lastPopupOpenedAt < CONFIG.POPUP_CLOSE_DELAY) return;

        const item = items[currentViewerIndex];
        if (!item) return;

        const itemName = item.name || "este item";
        if (!confirm(`Tem certeza que deseja excluir o item:
"${itemName}"?`)) return;

        items.splice(currentViewerIndex, 1);
        currentViewerIndex = -1;
        viewerOverlay.classList.remove("show");
        render();

        if (typeof AutoSaveSystem !== 'undefined') AutoSaveSystem.requestSave();
    }

    function closeViewer() {
        if (Date.now() - lastPopupOpenedAt < CONFIG.POPUP_CLOSE_DELAY) return;
        viewerOverlay.classList.remove("show");
        render();
        if (typeof AutoSaveSystem !== 'undefined') AutoSaveSystem.requestSave();
    }

    function exportItems() {return JSON.parse(JSON.stringify(items));}

    function importAllItems(newItems) {
        items = Array.isArray(newItems)
            ? newItems.map((it, i) => ({...it, id: it.id || (Date.now() + "_" + i)}))
            : [];
        render();
    }

    return {init, exportItems, importAllItems};
})();

/* ===============================================
         MÓDULO FICHA DE PERSONAGEM =============================================== */
const CharacterSheetModule = (() => {
    let currentEditingAttribute = null;
    const PERICIAS_DISPONIVEIS = ['Engenharia', 'Adestramento', 'Atletismo', 'Furtividade', 'Iniciativa', 'Persuadir', 'Tecnologia', 'Esgrima', 'Tática', 'Percepção', 'Condução', 'Pontaria', 'Sobrevivência', 'Fortitude', 'Combate'];
    let character = null;

    let modal, backButton, modalNameInput, modalAvatarInput, modalAvatarPlaceholder;
    let modalPVDisplay, modalPeDisplay, pvEditModal, peEditModal, attrEditModal, attrInput, attrTitle;

    const DEFAULT_CHARACTER = {
        name: 'Nome do Personagem',
        avatarUrl: '',
        attributes: {
            potencia: 0, reflexo: 0, precisao: 0, intelecto: 0, instinto: 0,
            pv_atual: 10, pv_max: 10, pe_atual: 0, pe_max: 20,
            ruptura_pr: 0, pontos_ocultos: 0, pericias: [],
            prot_fisica: 0, prot_eterea: 0, prot_mental: 0,
            status_corpo: {
                corpo: 'normal',
                braço_esq: 'normal',
                braço_dir: 'normal',
                pernas: 'normal'
            }
        }
    };

    function cloneDefaultCharacter() {
        return JSON.parse(JSON.stringify(DEFAULT_CHARACTER));
    }

    function normalizeNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function normalizeCharacter(data) {
        const base = cloneDefaultCharacter();
        const source = data && typeof data === 'object' ? data : {};
        const sourceAttrs = source.attributes && typeof source.attributes === 'object' ? source.attributes : {};

        const normalized = {
            name: typeof source.name === 'string' && source.name.trim() ? source.name : base.name,
            avatarUrl: typeof source.avatarUrl === 'string' ? source.avatarUrl : '',
            attributes: {
                ...base.attributes, ...sourceAttrs,
                ruptura_pr: sourceAttrs.ruptura_pr ?? sourceAttrs.fervor ?? base.attributes.ruptura_pr,
                pe_atual: sourceAttrs.pe_atual ?? sourceAttrs.san_atual ?? base.attributes.pe_atual,
                pe_max: sourceAttrs.pe_max ?? sourceAttrs.san_max ?? base.attributes.pe_max
            }
        };

        normalized.attributes.pericias = Array.isArray(sourceAttrs.pericias) ? sourceAttrs.pericias.filter(p => PERICIAS_DISPONIVEIS.includes(p)) : [];

        normalized.attributes.status_corpo = {
            ...base.attributes.status_corpo,
            ...(sourceAttrs.status_corpo && typeof sourceAttrs.status_corpo === 'object' ? sourceAttrs.status_corpo : {})
        };

        ['potencia', 'reflexo', 'precisao', 'intelecto', 'instinto', 'ruptura_pr', 'pontos_ocultos', 'prot_fisica', 'prot_eterea', 'prot_mental'].forEach(key => {
            normalized.attributes[key] = Math.max(0, Math.floor(normalizeNumber(normalized.attributes[key], 0)));
        });

        normalized.attributes.pv_max = Math.max(1, Math.floor(normalizeNumber(normalized.attributes.pv_max, 10)));
        normalized.attributes.pv_atual = Math.min(normalized.attributes.pv_max, Math.floor(normalizeNumber(normalized.attributes.pv_atual, 10)));
        normalized.attributes.pe_max = Math.max(1, Math.floor(normalizeNumber(normalized.attributes.pe_max, 20)));
        normalized.attributes.pe_atual = Math.max(0, Math.min(normalized.attributes.pe_max, Math.floor(normalizeNumber(normalized.attributes.pe_atual, 0))));

        return normalized;
    }

    function init() {
        modal = document.getElementById('ficha-modal');
        backButton = document.getElementById('modal-back-button');
        modalNameInput = document.getElementById('modal-name-input');
        modalAvatarInput = document.getElementById('modal-avatar-file-input');
        modalAvatarPlaceholder = document.getElementById('modal-avatar-placeholder');
        modalPVDisplay = document.getElementById('modal-pv-display');
        modalPeDisplay = document.getElementById('modal-pe-display');

        pvEditModal = document.getElementById('pv-edit-modal');
        peEditModal = document.getElementById('pe-edit-modal');
        attrEditModal = document.getElementById('attr-edit-modal');
        attrInput = document.getElementById('attr-input-value');
        attrTitle = document.getElementById('attr-popup-title');

        if (!modal) return;

        character = normalizeCharacter(character);
        bindEvents();
        renderCharacter();
    }

    function bindEvents() {
        if (backButton) backButton.addEventListener('click', closeFichaModal);
        modalNameInput?.addEventListener('input', handleNameInput);

        document.getElementById('pv-input-atual')?.addEventListener('input', savePVValue);
        document.getElementById('pv-input-max')?.addEventListener('input', savePVValue);
        document.getElementById('pe-input-atual')?.addEventListener('input', savePEValue);
        document.getElementById('pe-input-max')?.addEventListener('input', savePEValue);
        attrInput?.addEventListener('input', handleAttrInputChange);

        document.querySelectorAll('.control-button').forEach(btn => {
            btn.addEventListener('click', handleControlButtons);
        });

        document.querySelectorAll('.status-item').forEach(item => {
            item.addEventListener('click', () => handleBodyStatusClick(item));
        });

        [pvEditModal, peEditModal, attrEditModal].forEach(modalEl => {
            modalEl?.addEventListener('click', e => handleOutsideModalClick(e, modalEl));
        });

        modalPVDisplay?.addEventListener('click', openPVEditModal);
        modalPeDisplay?.addEventListener('click', openPEEditModal);
        modal?.addEventListener('click', handleAttributeClick);

        document.querySelector('.modal-avatar-container')?.addEventListener('click', () => modalAvatarInput?.click());
        modalAvatarInput?.addEventListener('change', handleAvatarChange);
    }

    function closeFichaModal() {
        if (modal) modal.style.display = 'none';
    }

    function handleNameInput() {
        if (!character) return;
        character.name = modalNameInput.value || 'Novo Personagem';
        requestSave();
    }

    function savePVValue() {
        if (!character) return;
        let max = parseInt(document.getElementById('pv-input-max')?.value, 10);
        let atual = parseInt(document.getElementById('pv-input-atual')?.value, 10);
        max = Number.isFinite(max) ? max : 1;
        atual = Number.isFinite(atual) ? atual : 0;
        if (max < 1) max = 1;
        if (atual > max) atual = max;

        document.getElementById('pv-input-max').value = max;
        document.getElementById('pv-input-atual').value = atual;
        character.attributes.pv_max = max;
        character.attributes.pv_atual = atual;
        renderCharacter();
        requestSave();
    }

    function savePEValue() {
        if (!character) return;
        let max = parseInt(document.getElementById('pe-input-max')?.value, 10);
        let atual = parseInt(document.getElementById('pe-input-atual')?.value, 10);
        max = Number.isFinite(max) ? max : 1;
        atual = Number.isFinite(atual) ? atual : 0;
        if (max < 1) max = 1;
        atual = Math.max(0, Math.min(max, atual));

        document.getElementById('pe-input-max').value = max;
        document.getElementById('pe-input-atual').value = atual;
        character.attributes.pe_max = max;
        character.attributes.pe_atual = atual;
        renderCharacter();
        requestSave();
    }

    function savePericias() {
        if (!character || currentEditingAttribute !== 'pontos_ocultos') return;
        const content = attrEditModal?.querySelector('.attr-edit-content');
        if (!content) return;
        character.attributes.pericias = Array.from(content.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
        const display = modal?.querySelector('[data-attr-display="pontos_ocultos"]');
        if (display) display.innerHTML = character.attributes.pericias.length ? character.attributes.pericias.map(nome => `<span class=\"pericia-linha\">— ${escapeHTML(nome)}</span>`).join('') : '0';
        requestSave();
    }

    function saveAttrValue() {
        if (!character || !currentEditingAttribute) return;
        let val = parseInt(attrInput?.value, 10);
        val = Number.isFinite(val) ? val : 0;
        val = Math.max(0, Math.min(99, val));
        character.attributes[currentEditingAttribute] = val;
        if (attrInput) attrInput.value = val;
        renderCharacter();
        requestSave();
    }

    function handleAttrInputChange() {
        if (!attrInput) return;
        if (attrInput.value.length > 2) attrInput.value = attrInput.value.slice(0, 2);
        if (parseInt(attrInput.value, 10) > 99) attrInput.value = 99;
        saveAttrValue();
    }

    function handleControlButtons(event) {
        const btn = event.currentTarget;
        const action = btn.innerText.trim() === '+' ? 1 : -1;
        let input;

        if (btn.dataset.pvType) input = pvEditModal?.querySelector(`#pv-input-${btn.dataset.pvType}`);
        else if (btn.dataset.peType) input = peEditModal?.querySelector(`#pe-input-${btn.dataset.peType}`);
        else input = attrInput;
        if (!input) return;

        let val = (parseInt(input.value, 10) || 0) + action;
        if (btn.dataset.pvType === 'atual') {
            const maxVal = parseInt(pvEditModal?.querySelector('#pv-input-max')?.value, 10) || 1;
            if (val > maxVal) val = maxVal;
        }
        if (btn.dataset.peType === 'atual') {
            const maxVal = parseInt(peEditModal?.querySelector('#pe-input-max')?.value, 10) || 1;
            val = Math.max(0, Math.min(maxVal, val));
        }
        if (input === attrInput) val = Math.max(0, Math.min(99, val));

        input.value = val;
        if (btn.dataset.pvType) savePVValue();
        else if (btn.dataset.peType) savePEValue();
        else saveAttrValue();
    }

    function handleBodyStatusClick(item) {
        if (!character) return;
        const part = item.dataset.bodyPart;
        const currentState = item.dataset.state;
        const states = typeof ESTADOS_DISPONIVEIS !== 'undefined' ? ESTADOS_DISPONIVEIS : ['normal', 'sangrando', 'quebrado', 'decepado'];
        const currentIndex = states.indexOf(currentState);
        const nextState = states[(currentIndex + 1 + states.length) % states.length];

        character.attributes.status_corpo[part] = nextState;
        renderCharacter();
        requestSave();
    }

    function handleOutsideModalClick(e, modalEl) {
        if (e.target !== modalEl) return;
        if (modalEl === pvEditModal) savePVValue();
        if (modalEl === peEditModal) savePEValue();
        if (modalEl === attrEditModal) {if (currentEditingAttribute === 'pontos_ocultos') savePericias(); else saveAttrValue();}
        modalEl.style.display = 'none';
    }

    function openPVEditModal() {
        if (!character || !pvEditModal) return;
        document.getElementById('pv-input-atual').value = character.attributes.pv_atual;
        document.getElementById('pv-input-max').value = character.attributes.pv_max;
        pvEditModal.style.display = 'flex';
    }

    function openPEEditModal() {
        if (!character || !peEditModal) return;
        document.getElementById('pe-input-atual').value = character.attributes.pe_atual;
        document.getElementById('pe-input-max').value = character.attributes.pe_max;
        peEditModal.style.display = 'flex';
    }

    function handleAttributeClick(e) {
        if (!character) return;
        const item = e.target.closest('.atributo-item');
        if (!item || item.classList.contains('status-item') || !item.dataset.attrName) return;

        currentEditingAttribute = item.dataset.attrName;
        const nomesAtributos = {
            potencia: 'Potência',
            reflexo: 'Reflexo',
            precisao: 'Precisão',
            intelecto: 'Intelecto',
            instinto: 'Instinto',
            fervor: 'Fervor',
            pontos_ocultos: 'Pontos Ocultos',
            prot_cinetica: 'Proteção Cinética',
            prot_balistica: 'Proteção Balística',
            prot_elemental: 'Proteção Elemental',
            prot_fisica: 'Proteção Física',
            prot_eterea: 'Proteção Etérea',
            prot_mental: 'Proteção Mental'
        };
        const nomeCompleto = nomesAtributos[currentEditingAttribute]
            || item.querySelector('.atributo-sigla')?.textContent?.trim()
            || item.dataset.attrSigla
            || currentEditingAttribute;
        if (attrTitle) attrTitle.textContent = `Editar ${nomeCompleto}`;
        if (currentEditingAttribute === 'pontos_ocultos') {
            if (attrTitle) attrTitle.textContent = 'Perícias';
            const content = attrEditModal?.querySelector('.attr-edit-content');
            if (content) {
                content.innerHTML = `<h3 id="attr-popup-title">Perícias</h3><div class="pericias-selector">${PERICIAS_DISPONIVEIS.map(nome => `<label><input type="checkbox" value="${nome}" ${character.attributes.pericias.includes(nome) ? 'checked' : ''}> ${nome}</label>`).join('')}</div>`;
                content.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', savePericias));
            }
        } else {
            const content = attrEditModal?.querySelector('.attr-edit-content');
            if (content) content.innerHTML = `<h3 id="attr-popup-title">Editar ${nomeCompleto}</h3><div class="attr-edit-item"><button class="control-button decrease-attr-popup">-</button><input type="number" id="attr-input-value" class="atributo-valor" min="0" max="99" value="${character.attributes[currentEditingAttribute] ?? 0}"><button class="control-button increase-attr-popup">+</button></div>`;
            attrInput = document.getElementById('attr-input-value');
            attrEditModal?.querySelectorAll('.control-button').forEach(btn => btn.addEventListener('click', handleControlButtons));
            attrInput?.addEventListener('input', handleAttrInputChange);
        }
        if (attrEditModal) attrEditModal.style.display = 'flex';
    }

    async function handleAvatarChange(e) {
        const file = e.target.files?.[0];
        if (!file || !character) return;
        try {
            const imagemReduzida = await comprimirImagem(file, 300, 0.7);
            character.avatarUrl = imagemReduzida;
            renderCharacter();
            requestSave();
        } catch (erro) {
            console.warn('Não foi possível processar a imagem.', erro);
        }
        e.target.value = '';
    }

    function renderCharacter() {
        if (!character || !modal) return;
        character = normalizeCharacter(character);
        const attrs = character.attributes;

        if (modalNameInput) modalNameInput.value = character.name;
        if (modalAvatarPlaceholder) {
            modalAvatarPlaceholder.innerHTML = character.avatarUrl ? `<img src="${escapeHTML(character.avatarUrl)}">` : '+';
        }

        modal.querySelectorAll('.atributo-valor-display').forEach(display => {
            const key = display.dataset.attrDisplay;
            display.textContent = attrs[key] !== undefined ? attrs[key] : 0;
        });

        const periciasDisplay = modal.querySelector('[data-attr-display="pontos_ocultos"]');
        if (periciasDisplay) periciasDisplay.innerHTML = attrs.pericias.length ? attrs.pericias.map(nome => `<span class=\"pericia-linha\">— ${escapeHTML(nome)}</span>`).join('') : '0';

        modal.querySelectorAll('.status-item').forEach(item => {
            const part = item.dataset.bodyPart;
            const state = attrs.status_corpo[part] || 'normal';
            item.dataset.state = state;
            const value = item.querySelector('.status-value');
            if (value) value.textContent = state.charAt(0).toUpperCase() + state.slice(1);
        });

        if (modalPVDisplay) {
            modalPVDisplay.className = `hp-bar-container${attrs.pv_atual < 0 ? ' negative-state' : ''}`;
            modalPVDisplay.innerHTML = createResourceBarHTML(attrs.pv_atual, attrs.pv_max, 'pv');
        }
        if (modalPeDisplay) {
            modalPeDisplay.className = 'hp-bar-container';
            modalPeDisplay.innerHTML = createResourceBarHTML(attrs.pe_atual, attrs.pe_max, 'pe');
        }

        if (modal.style.display === '' || modal.style.display === 'none') modal.style.display = 'block';
    }

    function exportCharacter() {
        return character ? JSON.parse(JSON.stringify(normalizeCharacter(character))) : null;
    }

    function importCharacter(importedCharacter) {
        character = normalizeCharacter(importedCharacter);
        renderCharacter();
        requestSave();
    }

    function requestSave() {
        if (typeof AutoSaveSystem !== 'undefined' && typeof AutoSaveSystem.requestSave === 'function') {
            AutoSaveSystem.requestSave();
        }
    }

    return {init, exportCharacter, importCharacter};
})();

/* ===============================================
           MÓDULO DE HABILIDADES =============================================== */
const SkillsModule = (() => {
    let data = null;

    function init() {
        const ficha = document.getElementById('ficha-modal');
        const inventory = document.getElementById('inventory-section');
        const skills = document.getElementById('skills-section');
        const openSkills = document.getElementById('open-skills-btn');
        const closeSkills = document.getElementById('close-skills-btn');
        const openInventory = document.getElementById('open-inventory-btn');
        const closeInventory = document.getElementById('close-inventory-btn');
        const importBtn = document.getElementById('skillImportBtn');
        const fileInput = document.getElementById('skillFileInput');
        const container = document.getElementById('skillSkillsContainer');
        const sheetIoMenu = document.getElementById('sheetIoMenu');

        const setSheetIoVisible = (visible) => {if (sheetIoMenu) sheetIoMenu.style.display = visible ? '' : 'none';};

        if (!skills) return;

        openInventory?.addEventListener('click', () => {
            if (inventory) inventory.style.display = 'block';
            if (ficha) ficha.style.display = 'none';
            setSheetIoVisible(false);
        });

        closeInventory?.addEventListener('click', () => {
            if (inventory) inventory.style.display = 'none';
            if (ficha) ficha.style.display = 'block';
            setSheetIoVisible(true);
        });

        openSkills?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (inventory) inventory.style.setProperty('display', 'none', 'important');
            if (ficha) ficha.style.setProperty('display', 'none', 'important');
            skills.style.setProperty('display', 'block', 'important');
            skills.style.setProperty('visibility', 'visible', 'important');
            skills.style.setProperty('opacity', '1', 'important');
            setSheetIoVisible(false);
            if (data) renderSkillsList(container, data);
        });

        closeSkills?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            skills.style.setProperty('display', 'none', 'important');
            skills.style.setProperty('visibility', 'hidden', 'important');
            if (ficha) ficha.style.setProperty('display', 'block', 'important');
            setSheetIoVisible(true);
        });

        if (importBtn && fileInput) {
            importBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                fileInput.click();
            });

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (x) => {
                    try {
                        data = JSON.parse(x.target.result);
                        window.__habilidadesImportadas = data;
                        renderSkillsList(container, data);
                    } catch (err) {
                        alert('Erro ao ler o arquivo JSON: ' + err.message);
                    }
                };
                reader.readAsText(file);
                e.target.value = '';
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && skills.style.display === 'block') {
                skills.style.setProperty('display', 'none', 'important');
                skills.style.setProperty('visibility', 'hidden', 'important');
                if (ficha) ficha.style.setProperty('display', 'block', 'important');
            }
        });
    }

    function extractSkillsData(d) {
        const out = [];
        if (!d || typeof d !== 'object') return out;

        const parseSlot = (sd, sn) => {
            if (!sd || typeof sd !== 'object') return;
            const circles = Array.isArray(sd.circulos) ? sd.circulos : [];
            const tags = Array.isArray(sd.tags) ? sd.tags : [];
            const map = new Map(tags.map(t => [String(t.id), t]));

            circles.filter(c => c && (c.desbloqueado === true || c.unlocked === true || c.ativo === true))
                .forEach(c => {
                    const ids = Array.isArray(c.tags) ? c.tags : [];
                    const t = ids.length ? map.get(String(ids[0])) : null;
                    out.push({...c, tag: t ? t.nome : '', tagCor: t ? t.cor : '', slotNome: sn || 'Slot'});
                });
        };

        if (Array.isArray(d.slots) && d.slots.length) {
            d.slots.forEach(s => {if (s && typeof s === 'object') parseSlot(s.dados || {}, s.nome || 'Slot');});
        } else if (Array.isArray(d.circulos)) {
            parseSlot(d, 'Slot atual');
        } else if (Array.isArray(d)) {
            d.filter(c => c && (c.desbloqueado === true || c.unlocked === true || c.ativo === true))
                .forEach(c => out.push({...c, tag: typeof c.tag === 'string' ? c.tag : '', tagCor: c.tagCor || '', slotNome: 'Slot'}));
        }

        return out;
    }

    function renderSkillsList(container, d) {
        if (!container) return;
        container.innerHTML = '';
        const nodes = extractSkillsData(d);

        if (!nodes.length) {
            container.innerHTML = '<div class="skills-empty-state">Nenhuma habilidade desbloqueada encontrada.</div>';
            return;
        }

        const groups = {};
        nodes.forEach(n => {
            const tag = typeof n.tag === 'string' && n.tag.trim() ? n.tag.trim() : 'Sem Tag';
            (groups[tag] ??= []).push(n);
        });

        Object.keys(groups).forEach(tag => {
            const groupEl = document.createElement('div');
            groupEl.className = 'skill-tag-group';

            const title = document.createElement('div');
            title.className = 'skill-tag-group-title';
            title.textContent = tag;

            const tc = groups[tag].find(n => n.tagCor);
            if (tc && tc.tagCor) title.style.color = tc.tagCor;
            groupEl.appendChild(title);

            const grid = document.createElement('div');
            grid.className = 'skills-grid-integrated';

            groups[tag].forEach(n => {
                const card = document.createElement('div');
                card.className = 'integrated-skill-card';
                const img = n.imagem || 'https://via.placeholder.com/50?text=Icon';
                card.innerHTML = `
            <div class="integrated-skill-header">
                <img src="${escapeHTML(img)}" alt="${escapeHTML(n.nome || 'Habilidade')}" class="integrated-skill-icon" onerror="this.src='https://via.placeholder.com/50?text=Erro'">
                <div class="integrated-skill-title-container">
                    <h3 class="integrated-skill-name">${escapeHTML(n.nome || 'Sem Nome')}</h3>
                    ${n.tag ? `<span class="integrated-skill-tag" ${n.tagCor ? `style="background-color:${escapeHTML(n.tagCor)}"` : ''}>${escapeHTML(n.tag)}</span>` : ''}
                </div>
            </div>
            <div class="integrated-skill-description">${n.descricao || 'Sem descrição informada.'}</div>
        `;
                grid.appendChild(card);
            });

            groupEl.appendChild(grid);
            container.appendChild(groupEl);
        });
    }

    function exportSkills() {return data || window.__habilidadesImportadas || null;}

    function importSkills(newData) {
        data = newData || null;
        window.__habilidadesImportadas = data;
        const c = document.getElementById('skillSkillsContainer');
        if (c) renderSkillsList(c, data);
    }

    return {init, exportSkills, importSkills};
})();


/* ===============================================
         MÓDULO DE ROLAGEM DE DADOS
================================================ */
const DiceModule = (() => {
    const dadosSelecionados = {
        4: 0,
        6: 0,
        8: 0,
        10: 0,
        12: 0,
        20: 0,
        100: 0
    };

    let bonus = 0;
    let atributoSelecionado = "";

    const $ = (id) => document.getElementById(id);

    function obterValorAtributo(nome) {
        if (!nome) return 0;

        const display = document.querySelector(
            `.atributo-valor-display[data-attr-display="${nome}"]`
        );

        const valor = Number(display?.textContent);
        return Number.isFinite(valor) ? valor : 0;
    }

    function obterBonusAtributo() {
        return atributoSelecionado ? obterValorAtributo(atributoSelecionado) : 0;
    }

    function atualizarBonusPopup() {
        const valorAtributo = obterBonusAtributo();
        const total = bonus + valorAtributo;
        const el = $("dice-bonus-value");
        const info = $("dice-bonus-attribute-value");

        if (el) el.textContent = total;

        if (info) {
            if (!atributoSelecionado) {
                info.textContent = "Sem atributo selecionado";
            } else {
                const select = $("dice-bonus-attribute");
                const nome = select?.selectedOptions?.[0]?.textContent || atributoSelecionado;
                info.textContent = `${nome}: +${valorAtributo}`;
            }
        }
    }

    function atualizarIndicador(tipo) {
        const indicador = $("dice-q" + tipo);
        if (!indicador) return;
        const quantidade = dadosSelecionados[tipo];
        indicador.textContent = quantidade;
        indicador.classList.toggle("show", quantidade > 0);
    }

    function adicionarDado(tipo) {
        dadosSelecionados[tipo]++;
        atualizarIndicador(tipo);
    }

    function resetarDado(tipo) {
        dadosSelecionados[tipo] = 0;
        atualizarIndicador(tipo);
    }

    function abrirPopupBonus() {
        atualizarBonusPopup();
        $("dice-popup-bg")?.classList.add("show");
    }

    function fecharPopupBonus() {
        $("dice-popup-bg")?.classList.remove("show");
    }

    function alterarBonus(valor) {
        bonus += valor;
        atualizarBonusPopup();
    }

    function selecionarAtributo(nome) {
        atributoSelecionado = nome || "";
        atualizarBonusPopup();
    }

    function classificar(valor) {
        if (valor >= 20) return {texto: "EXTREMO", classe: "dice-extremo"};
        if (valor >= 11) return {texto: "SUCESSO", classe: "dice-sucesso"};
        if (valor >= 6) return {texto: "NORMAL", classe: "dice-normal"};
        return {texto: "FALHA", classe: "dice-falha"};
    }

    function localAcerto(valor) {
        if (valor >= 20) return "Cabeça";
        if (valor >= 15) return "Corpo";
        if (valor >= 5) return "Braços";
        return "Pernas";
    }

    async function rolarDados() {
        let somaBruta = 0;
        const resultadosTexto = [];
        const formulaTexto = [];
        const totalElemento = $("dice-total");
        if (!totalElemento) return;

        totalElemento.classList.add("animando");

        let maiorDado = 0;
        for (const dado in dadosSelecionados) {
            if (dadosSelecionados[dado] > 0) {
                maiorDado = Math.max(maiorDado, Number(dado));
            }
        }

        if (maiorDado === 0) maiorDado = 20;

        for (let i = 0; i < 18; i++) {
            totalElemento.textContent =
                Math.floor(Math.random() * maiorDado) + 1;
            await new Promise(resolve => setTimeout(resolve, 55));
        }

        for (const dado in dadosSelecionados) {
            const quantidade = dadosSelecionados[dado];

            if (quantidade > 0) {
                formulaTexto.push(`${quantidade}D${dado}`);

                const rolls = [];
                for (let i = 0; i < quantidade; i++) {
                    const roll = Math.floor(Math.random() * Number(dado)) + 1;
                    somaBruta += roll;
                    rolls.push(roll);
                }

                resultadosTexto.push(
                    `${quantidade}D${dado}: [ ${rolls.join(" , ")} ]`
                );
            }
        }

        const bonusAtributo = obterBonusAtributo();
        const bonusTotal = bonus + bonusAtributo;
        const somaFinal = somaBruta + bonusTotal;
        totalElemento.classList.remove("animando");
        totalElemento.textContent = somaFinal;

        const resultado = classificar(somaFinal);
        const tipo = $("dice-tipo");
        if (tipo) {
            tipo.textContent = resultado.texto;
            tipo.className = "dice-type " + resultado.classe;
        }

        let formulaFinal = formulaTexto.join(" + ");
        if (!formulaFinal) formulaFinal = "0";

        if (bonusTotal > 0) formulaFinal += ` + ${bonusTotal}`;
        else if (bonusTotal < 0) formulaFinal += ` ${bonusTotal}`;

        const historico = $("dice-history-list");
        if (historico) {
            const novoItem = document.createElement("div");
            novoItem.className = "dice-history-item";
            novoItem.innerHTML = `
        <strong>${somaFinal}</strong> - ${resultado.texto}<br>
        Acerto: ${localAcerto(somaBruta)}<br>
        ${formulaFinal}
    `;
            historico.prepend(novoItem);
        }

        const formula = $("dice-formula");
        const local = $("dice-local");
        const info = $("dice-info");

        if (formula) formula.textContent = formulaFinal;
        if (local) local.textContent = `Acerto: ${localAcerto(somaBruta)}`;
        if (info) info.innerHTML = resultadosTexto.join("<br>");
    }

    function init() {
        const ficha = document.getElementById("ficha-modal");
        const diceSection = document.getElementById("dice-section");
        const openDice = document.getElementById("open-dice-btn");
        const closeDice = document.getElementById("close-dice-btn");
        const popup = document.getElementById("dice-popup-bg");
        const bonusBtn = document.getElementById("dice-bonus-btn");
        const rollBtn = document.getElementById("dice-roll-btn");
        const bonusMinus = document.getElementById("dice-bonus-minus");
        const bonusPlus = document.getElementById("dice-bonus-plus");
        const bonusAttribute = document.getElementById("dice-bonus-attribute");

        if (!diceSection || !openDice) return;

        openDice.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            document.getElementById("inventory-section")
                ?.style.setProperty("display", "none", "important");
            document.getElementById("skills-section")
                ?.style.setProperty("display", "none", "important");

            ficha?.style.setProperty("display", "none", "important");
            diceSection.style.setProperty("display", "block", "important");
            diceSection.style.setProperty("visibility", "visible", "important");
            diceSection.style.setProperty("opacity", "1", "important");

            document.getElementById("sheetIoMenu")?.style.setProperty("display", "none");
        });

        closeDice?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            diceSection.style.setProperty("display", "none", "important");
            diceSection.style.setProperty("visibility", "hidden", "important");
            ficha?.style.setProperty("display", "block", "important");
            document.getElementById("sheetIoMenu")?.style.setProperty("display", "");
        });

        document.querySelectorAll("#dice-section .dice-die").forEach(button => {
            button.addEventListener("click", () => {
                adicionarDado(Number(button.dataset.die));
            });
        });

        document.querySelectorAll("#dice-section .dice-quantity").forEach(indicator => {
            indicator.addEventListener("click", (e) => {
                e.stopPropagation();
                const tipo = Number(indicator.id.replace("dice-q", ""));
                resetarDado(tipo);
            });
        });

        bonusBtn?.addEventListener("click", abrirPopupBonus);
        bonusMinus?.addEventListener("click", () => alterarBonus(-1));
        bonusPlus?.addEventListener("click", () => alterarBonus(1));
        document.querySelectorAll("#dice-attribute-buttons .dice-attribute-btn").forEach(button => {
            button.addEventListener("click", () => {
                const estavaSelecionado = button.classList.contains("selected");

                document.querySelectorAll("#dice-attribute-buttons .dice-attribute-btn")
                    .forEach(btn => btn.classList.remove("selected"));

                if (estavaSelecionado) {
                    selecionarAtributo("");
                    return;
                }

                button.classList.add("selected");
                selecionarAtributo(button.dataset.attribute || "");
            });
        });
        rollBtn?.addEventListener("click", rolarDados);

        popup?.addEventListener("click", (e) => {
            if (e.target === popup) fecharPopupBonus();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                if (popup?.classList.contains("show")) {
                    fecharPopupBonus();
                    return;
                }
                if (diceSection.style.display === "block") {
                    closeDice?.click();
                }
            }
        });
    }

    return {init};
})();

/* ===============================================
           SALVAMENTO AUTOMÁTICO =============================================== */
const AutoSaveSystem = (() => {
    const DB_NAME = 'FixaRPG_AutoSave';
    const DB_VERSION = 1;
    const STORE = 'fichas';
    const KEY = 'ficha_atual';

    let dbPromise = null;
    let timer = null;
    let saving = false;
    let pending = false;
    let initialized = false;
    let loading = false;
    let loaded = false;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    function cloneJSON(value) {
        try {return JSON.parse(JSON.stringify(value));}
        catch (_) {return null;}
    }

    function collect() {
        let character = null;
        let items = null;
        let skills = null;

        try {character = CharacterSheetModule?.exportCharacter();} catch (_) { }
        try {items = InventorySystem?.exportItems();} catch (_) { }
        try {skills = SkillsModule?.exportSkills();} catch (_) { }

        return {
            version: 1,
            savedAt: new Date().toISOString(),
            character: cloneJSON(character),
            items: cloneJSON(items),
            skills: cloneJSON(skills)
        };
    }

    async function saveNow() {
        if (!initialized || loading || !loaded) return;

        if (saving) {
            pending = true;
            return;
        }

        saving = true;
        try {
            const data = collect();
            const db = await openDB();

            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(data, KEY);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
            });
        } catch (err) {
            console.warn('Falha no salvamento automático:', err);
        } finally {
            saving = false;
            if (pending) {
                pending = false;
                saveNow();
            }
        }
    }

    function schedule(delay = 500) {
        if (!initialized || loading || !loaded) return;
        clearTimeout(timer);
        timer = setTimeout(saveNow, delay);
    }

    function installChangeWatcher() {
        ['input', 'change'].forEach(type => {
            document.addEventListener(type, () => schedule(), true);
        });

        const observer = new MutationObserver(() => schedule(700));
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true
        });

        setInterval(() => saveNow(), 5000);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') saveNow();
        });

        window.addEventListener('pagehide', () => saveNow());
    }

    async function load() {
        loading = true;
        try {
            const db = await openDB();
            const data = await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get(KEY);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });

            if (!data) {
                loaded = true;
                loading = false;
                return false;
            }

            if (data.character && typeof CharacterSheetModule?.importCharacter === 'function') {
                CharacterSheetModule.importCharacter(data.character);
            }

            if (Array.isArray(data.items) && typeof InventorySystem?.importAllItems === 'function') {
                InventorySystem.importAllItems(data.items);
            }

            if (data.skills && typeof SkillsModule?.importSkills === 'function') {
                SkillsModule.importSkills(data.skills);
            }

            loaded = true;
            loading = false;
            return true;
        } catch (err) {
            console.warn('Falha ao carregar a ficha:', err);
            loaded = true;
            loading = false;
            return false;
        }
    }

    function init() {
        initialized = true;
        installChangeWatcher();
        setTimeout(() => load(), 250);
    }

    function requestSave(delay = 0) {
        if (!initialized || loading || !loaded) return;
        if (delay <= 0) saveNow();
        else schedule(delay);
    }

    async function resetSave() {
        clearTimeout(timer);

        try {
            const db = await openDB();

            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');

                tx.objectStore(STORE).delete(KEY);

                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
            });

            console.log('Save resetado com sucesso.');

            location.reload();

        } catch (err) {
            console.error('Erro ao resetar o save:', err);
            alert('Não foi possível resetar o save.');
        }
    }

    return {init, saveNow, schedule, load, requestSave, resetSave};
})();

/* ===============================================
   IMPORTAÇÃO / EXPORTAÇÃO COMPLETA DA FICHA =============================================== */
const FullSheetIO = (() => {
    function init() {
        const toggle = document.getElementById('sheetIoToggle');
        const popup = document.getElementById('sheetIoPopup');
        const exp = document.getElementById('sheetExportAll');
        const imp = document.getElementById('sheetImportAll');
        const input = document.getElementById('sheetImportAllInput');
        const reset = document.getElementById('sheetResetSave');

        if (!toggle) return;

        toggle.onclick = (e) => {
            e.stopPropagation();
            popup.classList.toggle('show');
        };

        document.addEventListener('click', (e) => {
            const menu = document.getElementById('sheetIoMenu');
            if (menu && !menu.contains(e.target)) {
                popup.classList.remove('show');
            }
        });

        exp.onclick = () => {
            const ficha = {
                version: 1,
                type: 'ficha-completa',
                exportedAt: new Date().toISOString(),
                character: CharacterSheetModule.exportCharacter(),
                items: InventorySystem.exportItems(),
                skills: SkillsModule.exportSkills()
            };

            const name = (ficha.character?.name || 'ficha').replace(/[\\/:*?"<>|]+/g, '_');
            const blob = new Blob([JSON.stringify(ficha, null, 2)], {type: 'application/json'});
            const a = document.createElement('a');

            a.href = URL.createObjectURL(blob);
            a.download = `${name}.json`;
            a.click();
            URL.revokeObjectURL(a.href);

            popup.classList.remove('show');
        };

        imp.onclick = () => input.click();

        input.onchange = (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);

                    if (!data || data.type !== 'ficha-completa') {
                        throw new Error('Arquivo não é uma ficha.');
                    }

                    CharacterSheetModule.importCharacter(data.character);
                    InventorySystem.importAllItems(data.items);
                    SkillsModule.importSkills(data.skills);
                } catch (err) {
                    alert('Erro ao importar, ' + err.message);
                }
            };

            reader.readAsText(file);
            input.value = '';
            popup.classList.remove('show');
        };


        reset.onclick = async () => {
            const confirmar = confirm(
                'Tem certeza que deseja resetar o save?\n\n' +
                'Todos os dados salvos atualmente serão apagados.'
            );

            if (!confirmar) return;

            popup.classList.remove('show');

            if (typeof AutoSaveSystem !== 'undefined') {
                await AutoSaveSystem.resetSave();
            }
        };

    }

    return {init};


})();

/* ===============================================
   INICIALIZAÇÃO GERAL DA APLICAÇÃO =============================================== */
document.addEventListener('DOMContentLoaded', () => {
    InventorySystem.init();
    CharacterSheetModule.init();
    SkillsModule.init();
    FullSheetIO.init();
    DiceModule.init();

    setTimeout(() => {
        if (typeof AutoSaveSystem !== 'undefined') AutoSaveSystem.init();
    }, 100);
});

