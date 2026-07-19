// Theater Split-Pane Window Manager Engine
window.SplitEngine = class {
    constructor(rootElement) {
        this.rootElement = rootElement;
        
        // Default layout: Grid Dashboard, Control Deck, Modules
        this.tree = { 
            id: 'pane-main', 
            tabs: [
                { title: 'Grid Dashboard', contentId: 'grid-mode-container' },
                { title: 'Control Deck', contentId: 'tab-control-deck' },
                { title: 'Modules', contentId: 'tab-modules' }
            ], 
            activeTabIndex: 0 
        };
        
        this.isDragging = false;
        this.dragContext = null;
        this.webviews = {}; // Track native webviews
        this.creationQueue = [];
        this.isProcessingQueue = false;
        this._initialRender = true;
        
        this.bindEvents();
        this.loadLayout().then(() => {
            this.render();
        });
        
        // Sync webviews on window resize
        window.addEventListener('resize', () => {
            requestAnimationFrame(() => this.syncAllWebviews());
        });

    }

    async loadLayout() {
        if (!window.__TAURI__) return;
        try {
            const data = await window.__TAURI__.core.invoke('read_config_file', { filename: 'split_layout.json' });
            if (data) {
                const parsed = JSON.parse(data);
                if (parsed && parsed.id) {
                    this.tree = parsed;
                    if (this.tree.isLocked && window.__TAURI__) {
                        window.__TAURI__.core.invoke('toggle_window_lock', { locked: true }).catch(e => console.error(e));
                    }
                }
            }
        } catch (e) {
            console.log("No existing layout found. Using default.");
        }
    }

    async saveLayout() {
        if (!window.__TAURI__) return;
        try {
            await window.__TAURI__.core.invoke('save_config_file', {
                filename: 'split_layout.json',
                content: JSON.stringify(this.tree)
            });
        } catch (e) {
            console.error("Failed to save layout:", e);
        }
    }

    bindEvents() {
        document.addEventListener('mousedown', this.onMouseDown.bind(this));
        document.addEventListener('mousemove', this.onMouseMove.bind(this));
        document.addEventListener('mouseup', this.onMouseUp.bind(this));
        
        if (window.__TAURI__) {
            window.__TAURI__.event.listen('child-zoom-changed', (e) => {
                const { label, zoom } = e.payload;
                let logStr = `Received child-zoom-changed event: label=${label}, zoom=${zoom}\n`;
                logStr += `this.webviews content: ${JSON.stringify(this.webviews)}\n`;
                let matched = false;
                for (const [nodeId, urlMap] of Object.entries(this.webviews)) {
                    for (const [url, webviewData] of Object.entries(urlMap)) {
                        logStr += `Checking webview entry: nodeId=${nodeId}, url=${url}, label=${webviewData.label}\n`;
                        if (webviewData.label === label) {
                            matched = true;
                            logStr += `Label matched successfully!\n`;
                            const res = this.findNodeAndParent(nodeId);
                            if (res && res.node && res.node.tabs) {
                                const activeTab = res.node.tabs[res.node.activeTabIndex];
                                logStr += `Found node & activeTab title: "${activeTab ? activeTab.title : 'none'}"\n`;
                                if (activeTab) {
                                    logStr += `Current zoom value: ${activeTab.zoom}, New zoom value: ${zoom}\n`;
                                    if (activeTab.zoom !== zoom) {
                                        activeTab.zoom = zoom;
                                        logStr += `Zoom changed! Invoking saveLayout()...\n`;
                                        this.saveLayout();
                                    } else {
                                        logStr += `Zoom factor is identical, skipping save.\n`;
                                    }
                                }
                            } else {
                                logStr += `Failed to find node or tabs for nodeId: ${nodeId}\n`;
                            }
                        }
                    }
                }
                if (!matched) {
                    logStr += `Label "${label}" did not match any entry in this.webviews!\n`;
                }
                window.__TAURI__.core.invoke('save_config_file', {
                    filename: 'zoom_debug.log',
                    content: logStr
                }).catch(() => {});
            });
        }
        
        document.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        
        // Use requestAnimationFrame for silky smooth 60fps syncing without lag
        const syncLoop = () => {
            this.syncAllWebviews();
            requestAnimationFrame(syncLoop);
        };
        requestAnimationFrame(syncLoop);

    }

    onWheel(e) {
        if (e.ctrlKey) {
            const splitBody = e.target.closest('.split-body');
            if (splitBody) {
                const nodeId = splitBody.id.replace('container-', '');
                const res = this.findNodeAndParent(nodeId);
                if (res && res.node && res.node.tabs) {
                    const activeTab = res.node.tabs[res.node.activeTabIndex];
                    if (activeTab && !activeTab.contentId.startsWith('webview::') && !activeTab.contentId.startsWith('tcp://')) {
                        e.preventDefault();
                        
                        let currentZoom = activeTab.zoom || 1.0;
                        if (e.deltaY < 0) {
                            currentZoom += 0.05;
                        } else {
                            currentZoom -= 0.05;
                        }
                        currentZoom = Math.min(Math.max(currentZoom, 0.25), 2.5);
                        currentZoom = Math.round(currentZoom * 100) / 100;
                        
                        if (activeTab.zoom !== currentZoom) {
                            activeTab.zoom = currentZoom;
                            const contentEl = this.contentNodes[activeTab.contentId];
                            if (contentEl) {
                                contentEl.style.zoom = currentZoom;
                            }
                            this.saveLayout();
                        }
                    }
                }
            }
        }
    }


    render() {
        // Create a hidden stash container if it doesn't exist
        if (!window.splitEngineStash) {
            window.splitEngineStash = document.createElement('div');
            window.splitEngineStash.id = 'split-engine-stash';
            window.splitEngineStash.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;overflow:hidden;pointer-events:none;';
            document.body.appendChild(window.splitEngineStash);
        }
        
        const contentNodes = {};
        const preserveIds = ['tab-control-deck', 'tab-modules', 'grid-mode-container'];
        preserveIds.forEach(id => {
            let el = (this.contentNodes && this.contentNodes[id]) ? this.contentNodes[id] : document.getElementById(id);
            if (el) {
                contentNodes[id] = el;
                window.splitEngineStash.appendChild(el);
            }
        });
        this.contentNodes = contentNodes;

        this.rootElement.innerHTML = '';
        const frag = this.renderNode(this.tree);
        frag.style.width = '100%';
        frag.style.height = '100%';
        this.rootElement.appendChild(frag);

        // On first render (app load), defer sync to let the browser fully resolve
        // flex layout — otherwise getBoundingClientRect() returns 0 for all panels.
        if (this._initialRender) {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    this._initialRender = false;
                    this.syncAllWebviews();
                }, 150);
            });
        } else {
            // Defer sync on subsequent renders so flexbox layout has time to calculate dimensions
            requestAnimationFrame(() => {
                this.syncAllWebviews();
            });
        }

        // Re-render grid buttons after DOM is rebuilt
        requestAnimationFrame(() => {
            if (window.renderButtonGrid) window.renderButtonGrid();
        });
    }

    renderNode(node) {
        if (node.tabs) {
            // Leaf node with Tabs
            const el = document.createElement('div');
            el.className = 'split-leaf';
            el.dataset.nodeId = node.id;
            if (node.weight) el.style.flex = `${node.weight} 1 0%`;

            // Tab Bar
            const header = document.createElement('div');
            header.className = 'split-tab-bar';
            
            const tabsContainer = document.createElement('div');
            tabsContainer.className = 'tabs-container';
            
            node.tabs.forEach((tab, index) => {
                const tabEl = document.createElement('div');
                tabEl.className = `split-tab ${index === node.activeTabIndex ? 'active' : ''}`;
                
                const titleSpan = document.createElement('span');
                titleSpan.innerText = tab.title;
                tabEl.appendChild(titleSpan);
                
                // Add close button if it's not a base tab
                const isBaseTab = ['grid-mode-container', 'tab-control-deck', 'tab-modules'].includes(tab.contentId);
                if (!isBaseTab) {
                    const closeBtn = document.createElement('span');
                    closeBtn.innerHTML = '&times;';
                    closeBtn.className = 'tab-close-btn';
                    closeBtn.title = 'Close Tab';
                    closeBtn.onclick = (e) => {
                        e.stopPropagation(); // prevent clicking the tab itself
                        
                        node.tabs.splice(index, 1);
                        
                        if (node.tabs.length === 0) {
                            // If it's the last tab in this node, add an empty dock so the pane doesn't vanish unexpectedly
                            node.tabs.push({ title: 'New Webpage', contentId: 'empty-web-dock' });
                            node.activeTabIndex = 0;
                        } else if (node.activeTabIndex >= node.tabs.length) {
                            node.activeTabIndex = node.tabs.length - 1;
                        } else if (node.activeTabIndex === index) {
                            // If we closed the active tab, just fall back to the first one safely
                            node.activeTabIndex = Math.max(0, index - 1);
                        }
                        
                        this.render();
                        this.saveLayout();
                        if (window.renderButtonGrid) window.renderButtonGrid();
                    };
                    tabEl.appendChild(closeBtn);
                }
                
                tabEl.onclick = () => {
                    node.activeTabIndex = index;
                    this.render();
                    this.saveLayout();
                    if (window.renderButtonGrid) window.renderButtonGrid();
                };
                tabsContainer.appendChild(tabEl);
            });
            
            const addTabBtn = document.createElement('button');
            addTabBtn.className = 'add-tab-btn';
            addTabBtn.innerText = '+';
            addTabBtn.title = 'Add New Tab';
            addTabBtn.onclick = () => {
                node.tabs.push({ title: 'New Webpage', contentId: 'empty-web-dock' });
                node.activeTabIndex = node.tabs.length - 1;
                this.render();
                this.saveLayout();
            };
            tabsContainer.appendChild(addTabBtn);
            
            const controls = document.createElement('div');
            controls.className = 'tab-controls';
            
            // Split buttons
            const splitV = document.createElement('button');
            splitV.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>';
            splitV.title = "Split Vertically (Side-by-Side)";
            splitV.onclick = () => this.splitNode(node, 'horizontal');
            
            const splitH = document.createElement('button');
            splitH.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line></svg>';
            splitH.title = "Split Horizontally (Top/Bottom)";
            splitH.onclick = () => this.splitNode(node, 'vertical');

            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.title = "Close Panel";
            closeBtn.onclick = () => this.closeNode(node.id);
            
            const activeTab = node.tabs[node.activeTabIndex];
            if (activeTab && activeTab.contentId.startsWith('webview::')) {

            }
            
            controls.appendChild(splitH);
            controls.appendChild(splitV);
            
            const hasBaseTabs = node.tabs.some(t => ['grid-mode-container', 'tab-control-deck', 'tab-modules'].includes(t.contentId));
            
            if (hasBaseTabs) {
                const lockBtn = document.createElement('button');
                const isLocked = this.tree.isLocked || false;
                lockBtn.innerHTML = isLocked ? '🔒' : '🔓';
                lockBtn.title = isLocked ? "Unlock Layout & Window" : "Lock Layout & Window";
                lockBtn.onclick = () => {
                    this.tree.isLocked = !this.tree.isLocked;
                    this.saveLayout();
                    this.render();
                    if (window.__TAURI__) {
                        window.__TAURI__.core.invoke('toggle_window_lock', { locked: this.tree.isLocked }).catch(e => console.error(e));
                    }
                };
                controls.appendChild(lockBtn);
            }
            
            if (!hasBaseTabs) {
                controls.appendChild(closeBtn);
            }
            
            if (this.tree.isLocked) {
                splitH.style.display = 'none';
                splitV.style.display = 'none';
                closeBtn.style.display = 'none';
            }
            
            header.appendChild(tabsContainer);
            header.appendChild(controls);
            el.appendChild(header);

            // Active Content Body
            const body = document.createElement('div');
            body.className = 'split-body';
            body.id = `container-${node.id}`;
            
            if (activeTab) {
                if (this.contentNodes[activeTab.contentId]) {
                    const contentEl = this.contentNodes[activeTab.contentId];
                    if (contentEl) {
                        // Ensure element is fully visible when re-attached
                        contentEl.style.display = 'block';
                        contentEl.style.visibility = 'visible';
                        contentEl.style.width = '100%';
                        contentEl.style.height = '100%';
                        contentEl.style.zoom = activeTab.zoom || 1.0;
                        body.appendChild(contentEl);
                    }
                } else if (activeTab.contentId === 'empty-web-dock') {
                    const wrap = document.createElement('div');
                    wrap.style.cssText = 'padding: 20px; display: flex; flex-direction: column; gap: 15px; align-items: center; justify-content: center; height: 100%; color: #888; text-align: center;';
                    
                    const title = document.createElement('h3');
                    title.innerText = 'Open Webpage';
                    title.style.margin = '0';
                    title.style.color = '#ccc';
                    
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.placeholder = 'https://...';
                    input.style.cssText = 'padding: 10px; border-radius: 4px; border: 1px solid #444; background: #1a1a1a; color: white; width: 80%; max-width: 400px; text-align: center; font-size: 1.1em;';
                    
                    const btn = document.createElement('button');
                    btn.innerText = 'Load Page';
                    btn.style.cssText = 'padding: 10px 30px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 1em;';
                    
                    btn.onclick = () => {
                        let url = input.value.trim();
                        if (!url) return;
                        if (url.match(/^[a-zA-Z]:\\/) || url.match(/^[a-zA-Z]:\//)) {
                            url = 'file:///' + url.replace(/\\/g, '/');
                        } else if (!url.startsWith('http') && !url.startsWith('tcp://') && !url.startsWith('file://')) {
                            url = 'https://' + url;
                        }
                        activeTab.contentId = 'webview::' + url;
                        let titleVal = url;
                        if (url.startsWith('file://') || url.match(/^[a-zA-Z]:[\\/]/)) {
                            titleVal = url.replace(/^file:\/\/\//, '').split('/').pop().split('#')[0].split('?')[0];
                        } else {
                            titleVal = url.replace(/^https?:\/\//, '').split('/')[0];
                        }
                        activeTab.title = titleVal || "Webpage";
                        this.render();
                        this.saveLayout();
                    };
                    
                    wrap.appendChild(title);
                    wrap.appendChild(input);
                    wrap.appendChild(btn);
                    body.appendChild(wrap);
                } else if (activeTab.contentId && (activeTab.contentId.startsWith('tcp://') || activeTab.contentId.startsWith('webview::'))) {
                    // Webview will be placed here natively via syncAllWebviews
                    let targetUrl = activeTab.contentId;
                    if (targetUrl.startsWith('tcp://')) targetUrl = targetUrl.replace('tcp://', 'http://');
                    else targetUrl = targetUrl.substring(9);
                    // Webview creation is handled entirely by syncAllWebviews
                }
            }
            
            el.appendChild(body);
            return el;
        } else {
            // Parent node
            const el = document.createElement('div');
            el.className = `split-parent split-${node.type}`;
            el.dataset.nodeId = node.id;
            if (node.weight) {
                el.style.flex = `${node.weight} 1 0%`;
            }

            node.children.forEach((child, index) => {
                el.appendChild(this.renderNode(child));
                // Add divider between children
                if (index < node.children.length - 1) {
                    const divider = document.createElement('div');
                    divider.className = `split-divider divider-${node.type}`;
                    divider.dataset.index = index;
                    divider.dataset.parentId = node.id;
                    
                    const handle = document.createElement('div');
                    handle.className = 'divider-handle';
                    divider.appendChild(handle);
                    
                    el.appendChild(divider);
                }
            });
            return el;
        }
    }

    findNodeAndParent(id, currentNode = this.tree, parent = null) {
        if (currentNode.id === id) return { node: currentNode, parent };
        if (currentNode.children) {
            for (let child of currentNode.children) {
                const res = this.findNodeAndParent(id, child, currentNode);
                if (res) return res;
            }
        }
        return null;
    }

    splitNode(node, type) {
        const tabs = node.tabs;
        const activeTabIndex = node.activeTabIndex;
        delete node.tabs;
        delete node.activeTabIndex;
        node.type = type;
        node.children = [
            { id: node.id + '_a', weight: 50, tabs: tabs, activeTabIndex: activeTabIndex },
            { id: node.id + '_b', weight: 50, tabs: [{ title: 'New Webpage', contentId: 'empty-web-dock' }], activeTabIndex: 0 }
        ];
        this.render();
        this.saveLayout();
    }

    closeNode(id) {
        const res = this.findNodeAndParent(id);
        if (!res) return;
        
        if (!res.parent) {
            // Closing the root pane! Just reset it to a single empty dock.
            this.destroyWebviewForNode(id);
            if (this.tree.children) {
                // Destroy all nested webviews recursively
                const destroyAll = (node) => {
                    this.destroyWebviewForNode(node.id);
                    if (node.children) node.children.forEach(destroyAll);
                };
                this.tree.children.forEach(destroyAll);
            }
            this.tree = { id: 'pane-main', tabs: [{ title: 'New Webpage', contentId: 'empty-web-dock' }], activeTabIndex: 0 };
            this.render();
            this.saveLayout();
            return;
        }
        
        const parent = res.parent;
        const index = parent.children.findIndex(c => c.id === id);
        
        this.destroyWebviewForNode(id);
        parent.children.splice(index, 1);
        
        if (parent.children.length === 1) {
            const onlyChild = parent.children[0];
            if (onlyChild.tabs) {
                parent.tabs = onlyChild.tabs;
                parent.activeTabIndex = onlyChild.activeTabIndex;
            } else {
                parent.type = onlyChild.type;
                parent.children = onlyChild.children;
            }
        } else {
            parent.children.forEach(c => c.weight = 100 / parent.children.length);
        }
        
        this.render();
        this.saveLayout();
    }

    onMouseDown(e) {
        const divider = e.target.closest('.split-divider');
        if (divider) {
            this.isDragging = true;
            const isHorizontal = divider.classList.contains('divider-horizontal');
            const parentId = divider.dataset.parentId;
            const index = parseInt(divider.dataset.index);
            
            this.dragContext = {
                isHorizontal,
                parentId,
                index,
                startX: e.clientX,
                startY: e.clientY
            };
            
            document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
            document.querySelectorAll('.split-body').forEach(el => el.style.pointerEvents = 'none');
            
            // Force hide webviews immediately so they don't swallow mouse events during drag
            this.syncAllWebviews();
        }
    }

    onMouseMove(e) {
        if (!this.isDragging || !this.dragContext) return;
        
        const { isHorizontal, parentId, index } = this.dragContext;
        const parentRes = this.findNodeAndParent(parentId);
        if (!parentRes) return;
        const parentNode = parentRes.node;
        
        const childA = parentNode.children[index];
        const childB = parentNode.children[index + 1];
        
        const domA = document.querySelector(`[data-node-id="${childA.id}"]`);
        const domB = document.querySelector(`[data-node-id="${childB.id}"]`);
        
        if (!domA || !domB) return;
        
        const parentDom = domA.parentElement;
        const totalSize = isHorizontal ? parentDom.clientWidth : parentDom.clientHeight;
        const delta = isHorizontal ? e.movementX : e.movementY;
        
        const deltaPercent = (delta / totalSize) * 100;
        
        childA.weight += deltaPercent;
        childB.weight -= deltaPercent;
        
        if (childA.weight < 5) { childB.weight += childA.weight - 5; childA.weight = 5; }
        if (childB.weight < 5) { childA.weight += childB.weight - 5; childB.weight = 5; }
        
        domA.style.flex = `${childA.weight} 1 0%`;
        domB.style.flex = `${childB.weight} 1 0%`;
        
        this.syncAllWebviews();
    }

    onMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
            this.dragContext = null;
            document.body.style.cursor = '';
            document.querySelectorAll('.split-body').forEach(el => el.style.pointerEvents = 'auto');
            this.syncAllWebviews();
            this.saveLayout();
        }
    }

    async loadUrlInNode(nodeId, url) {
        const res = this.findNodeAndParent(nodeId);
        if (res && res.node && res.node.tabs) {
            const activeTab = res.node.tabs[res.node.activeTabIndex];
            if (activeTab) {
                activeTab.contentId = 'webview::' + url;
                let titleVal = url;
                if (url.startsWith('file://') || url.match(/^[a-zA-Z]:[\\/]/)) {
                    titleVal = url.replace(/^file:\/\/\//, '').split('/').pop().split('#')[0].split('?')[0];
                } else {
                    titleVal = url.replace(/^https?:\/\//, '').split('/')[0];
                }
                activeTab.title = titleVal || "Webpage";
                this.saveLayout();
                const tabEl = document.querySelector(`.split-leaf[data-node-id="${nodeId}"] .split-tab.active span`);
                if (tabEl) tabEl.innerText = activeTab.title;
            }
        }
        
        const bodyId = `container-${nodeId}`;
        const bodyEl = document.getElementById(bodyId);
        if (!bodyEl) return;
        
        bodyEl.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#888;">
            Native Webview Active: ${url}
        </div>`;
        
        this.syncAllWebviews();
    }

    syncAllWebviews() {
        if (!window.__TAURI__ || this._initialRender) return;

        // Build a map of ALL webview tabs across the entire tree:
        //   paneWebviews[nodeId][url] = { active: bool }
        // By scanning ALL tabs (not just the active one) we know which windows
        // to keep alive (hidden) vs destroy vs create.
        const paneWebviews = {};
        const forceHide = this.isDragging;

        const findAllPaneWebviews = (node) => {
            if (node.tabs) {
                node.tabs.forEach((tab, index) => {
                    if (tab.contentId && (tab.contentId.startsWith('tcp://') || tab.contentId.startsWith('webview::'))) {
                        let url = tab.contentId;
                        if (url.startsWith('tcp://')) url = url.replace('tcp://', 'http://');
                        else url = url.substring(9); // strip 'webview::'
                        if (!paneWebviews[node.id]) paneWebviews[node.id] = {};
                        const isActive = (index === node.activeTabIndex) && !forceHide;
                        if (!paneWebviews[node.id][url] || isActive) {
                            paneWebviews[node.id][url] = { active: isActive, tab: tab };
                        }
                    }
                });
            } else if (node.children) {
                node.children.forEach(findAllPaneWebviews);
            }
        };
        findAllPaneWebviews(this.tree);

        // --- Pass 1: update/hide/destroy existing tracked webviews ---
        for (const [nodeId, urlMap] of Object.entries(this.webviews)) {
            for (const [url, webviewData] of Object.entries(urlMap)) {
                // URL no longer in any tab → destroy
                if (!paneWebviews[nodeId] || !paneWebviews[nodeId][url]) {
                    if (!webviewData.isCreating) {
                        window.__TAURI__.core.invoke('destroy_child_webview', { label: webviewData.label })
                            .catch(e => console.warn('destroy_child_webview failed:', e));
                    }
                    delete this.webviews[nodeId][url];
                    this.creationQueue = this.creationQueue.filter(item => !(item.nodeId === nodeId && item.url === url));
                    continue;
                }

                const bodyEl = document.getElementById(`container-${nodeId}`);
                const isActive = paneWebviews[nodeId][url].active;

                // Skip updating bounds/visibility if the webview window is still being built
                if (webviewData.isCreating) continue;

                if (isActive && bodyEl) {
                    let focusRequested = false;
                    // SHOW & reposition
                    if (webviewData.isHidden) {
                        webviewData.isHidden = false;
                        webviewData.lastRect = null;
                        focusRequested = true;
                    }
                    const rect = bodyEl.getBoundingClientRect();
                    const physWidth  = Math.max(0, rect.width  - 4);
                    const physHeight = Math.max(0, rect.height - 4);
                    
                    if (rect.width === 0 || rect.height === 0) {
                        // Flexbox layout hasn't calculated yet; skip frame to avoid 100x100 square bugs
                        continue;
                    }
                    
                    const x = Math.round(rect.left);
                    const y = Math.round(rect.top);
                    const w = Math.round(physWidth);
                    const h = Math.round(physHeight);

                    if (!focusRequested &&
                        webviewData.lastRect &&
                        webviewData.lastRect.x      === x  &&
                        webviewData.lastRect.y      === y  &&
                        webviewData.lastRect.width  === w  &&
                        webviewData.lastRect.height === h) {
                        continue;
                    }
                    webviewData.lastRect = { x, y, width: w, height: h };
                    window.__TAURI__.core.invoke('update_child_webview', {
                        label: webviewData.label,
                        x, y, width: w, height: h,
                        focus: focusRequested
                    });
                } else {
                    // HIDE — SW_HIDE keeps renderer alive, no reload
                    if (webviewData.isHidden) continue;
                    webviewData.isHidden = true;
                    webviewData.lastRect = null;
                    window.__TAURI__.core.invoke('hide_child_webview', { label: webviewData.label })
                        .catch(e => console.warn('hide_child_webview failed:', e));
                }
            }
        }

        // --- Pass 2: queue windows for ALL tabs not yet tracked ---
        for (const [nodeId, urlMap] of Object.entries(paneWebviews)) {
            if (!this.webviews[nodeId]) this.webviews[nodeId] = {};
            for (const [url, { active, tab }] of Object.entries(urlMap)) {
                if (this.webviews[nodeId][url]) continue;

                const bodyEl = document.getElementById(`container-${nodeId}`);
                if (!bodyEl) continue;

                const rect = bodyEl.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) {
                    continue; // Skip enqueuing if flexbox layout has not calculated yet
                }
                const physWidth  = Math.max(0, rect.width  - 4);
                const physHeight = Math.max(0, rect.height - 4);
                const newLabel = `webview_${nodeId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

                const x = Math.round(rect.left);
                const y = Math.round(rect.top);
                const w = Math.max(100, Math.round(physWidth));
                const h = Math.max(100, Math.round(physHeight));

                // Mark in tracking dictionary immediately as isCreating to block duplicate enqueues
                this.webviews[nodeId][url] = {
                    label: newLabel,
                    isHidden: !active,
                    isCreating: true,
                    lastRect: null
                };

                const queueItem = {
                    nodeId,
                    url,
                    tab,
                    active,
                    label: newLabel,
                    x, y, w, h
                };

                // Prioritize active webviews by putting them at the front of the queue
                if (active) {
                    this.creationQueue.unshift(queueItem);
                } else {
                    this.creationQueue.push(queueItem);
                }
            }
        }

        // Start processing the queue if not already processing
        this.processCreationQueue();
    }

    processCreationQueue() {
        if (this.isProcessingQueue || this.creationQueue.length === 0) return;
        this.isProcessingQueue = true;

        const processNext = async () => {
            if (this.creationQueue.length === 0) {
                this.isProcessingQueue = false;
                return;
            }

            const item = this.creationQueue.shift();
            const { nodeId, url, tab, active, label, x, y, w, h } = item;

            // Check if it was deleted or removed from tracking dictionary while waiting in queue
            if (!this.webviews[nodeId] || !this.webviews[nodeId][url]) {
                processNext();
                return;
            }

            console.log(`[Frontend] ProcessQueue: Creating webview for URL: ${url} (visible: ${active}) with zoom: ${tab.zoom}`);
            try {
                await window.__TAURI__.core.invoke('create_child_webview', {
                    label, url,
                    x, y, width: w, height: h,
                    zoom: tab.zoom || null,
                    visible: active
                });

                if (this.webviews[nodeId] && this.webviews[nodeId][url]) {
                    this.webviews[nodeId][url].isCreating = false;
                } else {
                    // Late deletion check: it was deleted during creation, so we must clean it up now
                    window.__TAURI__.core.invoke('destroy_child_webview', { label })
                        .catch(e => console.warn('destroy_child_webview after late deletion failed:', e));
                }
            } catch (e) {
                console.error('Failed to create child webview in queue:', e);
                window.__TAURI__.core.invoke('save_config_file', {
                    filename: 'frontend_error.log',
                    content: `Failed to create child webview in queue: ${e.message || e}\n`
                }).catch(() => {});

                // Remove from tracking since creation failed
                if (this.webviews[nodeId]) {
                    delete this.webviews[nodeId][url];
                }
            }

            // Introduce a short settle delay to avoid resource spikes
            setTimeout(processNext, 100);
        };

        processNext();
    }

    async destroyWebviewForNode(nodeId) {
        // Cancel pending creations in the queue for this node
        this.creationQueue = this.creationQueue.filter(item => item.nodeId !== nodeId);

        if (this.webviews[nodeId]) {
            for (const [url, webviewData] of Object.entries(this.webviews[nodeId])) {
                if (window.__TAURI__) {
                    await window.__TAURI__.core.invoke('destroy_child_webview', {
                        label: webviewData.label
                    }).catch(e => console.warn(e));
                }
            }
            delete this.webviews[nodeId];
        }
    }
}
window.TheaterSplitEngine = SplitEngine;
