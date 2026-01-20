document.addEventListener('DOMContentLoaded', async () => {
    // --- Bmob Init ---
    // Initialize Bmob with Application ID and REST API Key
    Bmob.initialize("8286b8f9012aed97ea64e055192e2219", "3ea4900440a592446fc4e0ba1434f7e2");

    // --- Default Data (Books Only - Deprecated/Fallback) ---
    // The previous DEFAULT_DATA logic is largely superseded by Bmob Cloud, 
    // but we can keep the structure if we need manual defaults later.
    // For now, removing the auto-load logic to rely on Cloud entirely.

    // --- IndexedDB Helper ---
    const ReaderDB = {
        dbName: 'ReaderDB',
        version: 1,
        db: null,

        async init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.version);

                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('files')) {
                        db.createObjectStore('files', { keyPath: 'fileName' });
                    }
                };

                request.onsuccess = async (e) => {
                    this.db = e.target.result;
                    console.log('IndexedDB initialized');

                    // Auto-load defaults if empty
                    try {
                        const count = await this.countFiles();
                        if (count === 0) {
                            console.log('Initializing default books...');
                            for (const book of DEFAULT_DATA.books) {
                                await this.saveFile(book);
                            }
                        }
                    } catch (err) {
                        console.warn('Error loading defaults:', err);
                    }

                    resolve(this.db);
                };

                request.onerror = (e) => {
                    console.error('IndexedDB error:', e.target.error);
                    reject(e.target.error);
                };
            });
        },

        async countFiles() {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['files'], 'readonly');
                const store = transaction.objectStore('files');
                const request = store.count();
                request.onsuccess = () => resolve(request.result);
                request.onerror = (e) => reject(e.target.error);
            });
        },

        async saveFile(fileData) {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['files'], 'readwrite');
                const store = transaction.objectStore('files');
                const request = store.put(fileData);

                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        },

        async getAllFiles() {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['files'], 'readonly');
                const store = transaction.objectStore('files');
                const request = store.getAll();

                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = (e) => reject(e.target.error);
            });
        },

        async getFile(fileName) {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['files'], 'readonly');
                const store = transaction.objectStore('files');
                const request = store.get(fileName);

                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = (e) => reject(e.target.error);
            });
        },

        async deleteFile(fileName) {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['files'], 'readwrite');
                const store = transaction.objectStore('files');
                const request = store.delete(fileName);

                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        }
    };

    // Initialize DB then render
    await ReaderDB.init();
    renderLibrary();

    // --- State & Navigation ---
    const views = {
        bookstore: document.getElementById('bookstore-view'),
        blog: document.getElementById('blog-view'),
        reader: document.getElementById('reader-view')
    };

    const navBtns = document.querySelectorAll('.nav-btn');

    function switchView(viewName) {
        Object.values(views).forEach(el => el.classList.remove('active', 'hidden'));
        Object.values(views).forEach(el => el.classList.add('hidden'));

        if (views[viewName]) {
            views[viewName].classList.remove('hidden');
            views[viewName].classList.add('active');
        }

        navBtns.forEach(btn => {
            if (btn.dataset.target === `${viewName}-view`) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        if (viewName === 'bookstore') renderLibrary();
        if (viewName === 'blog') renderBlogList(); // Default to list
        if (viewName !== 'reader') {
            document.getElementById('sidebar').classList.remove('open');
        }
    }

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target.replace('-view', '');
            switchView(target);
        });
    });

    document.getElementById('back-home-btn').addEventListener('click', () => switchView('bookstore'));


    // --- Bookstore & Library Logic ---
    const bookGrid = document.getElementById('book-grid');
    const uploadCard = document.getElementById('upload-card');
    const fileInput = document.getElementById('file-input');
    // Sample book card removed (auto-loaded)

    uploadCard.addEventListener('click', () => fileInput.click());

    function handleFileUpload(file) {
        // Visual feedback
        const uploadCardTitle = uploadCard.querySelector('.card-title');
        const originalText = uploadCardTitle.textContent;
        uploadCardTitle.textContent = '上传中...';
        uploadCard.style.pointerEvents = 'none';

        // 1. Upload File to Bmob
        const bmobFile = Bmob.File(file.name, file);
        bmobFile.save().then(res => {
            const fileUrl = res[0].url; // Usually res is array [ { filename, group, url } ] or object depending on SDK version
            console.log('File uploaded:', fileUrl);

            // 2. Save Metadata to Bmob 'Books' table
            const query = Bmob.Query('Books');
            query.set("title", file.name.replace(/\.(txt|pdf)$/i, ''));
            query.set("fileName", file.name);
            query.set("fileUrl", fileUrl); // Important: Cloud URL
            query.set("type", file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain'));
            query.set("lastRead", Date.now());
            query.set("progress", 0);

            return query.save();
        }).then(bookObj => {
            // 3. Cache content locally for immediate access (Optimization)
            const fileReader = new FileReader();
            fileReader.onload = async (e) => {
                const arrayBuffer = e.target.result;
                const fileData = {
                    fileName: file.name, // Local Key
                    title: bookObj.title,
                    type: bookObj.type,
                    content: arrayBuffer,
                    lastRead: Date.now(),
                    cloudId: bookObj.objectId // Link to Cloud
                };
                await ReaderDB.saveFile(fileData);

                uploadCardTitle.textContent = originalText;
                uploadCard.style.pointerEvents = 'auto';
                renderLibrary(); // Reload list
            };
            fileReader.readAsArrayBuffer(file);

        }).catch(err => {
            console.error('Upload failed', err);
            alert('上传失败: ' + (err.message || JSON.stringify(err)));
            uploadCardTitle.textContent = originalText;
            uploadCard.style.pointerEvents = 'auto';
        });
    }

    function decodeText(arrayBuffer) {
        const uint8Array = new Uint8Array(arrayBuffer);
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        try {
            return utf8Decoder.decode(uint8Array);
        } catch (e) {
            console.log('UTF-8 decode failed, trying GBK');
            const gbkDecoder = new TextDecoder('gbk', { fatal: false });
            return gbkDecoder.decode(uint8Array);
        }
    }

    async function loadPdfBook(fileData) {
        switchView('reader');
        navBookTitle.textContent = fileData.title + ' (Loading...)';
        readerContent.innerHTML = '<div class="loading-indicator">正在加载 PDF...</div>';
        tocList.innerHTML = ''; // clear TOC
        currentBookFileName = fileData.fileName; // Set current

        try {
            // content from DB is ArrayBuffer
            const data = fileData.content;
            const pdf = await pdfjsLib.getDocument({ data: data }).promise;

            navBookTitle.textContent = fileData.title;
            readerContent.innerHTML = ''; // Clear loading

            // Update last read
            fileData.lastRead = Date.now();
            ReaderDB.saveFile(fileData);

            // 1. Render All Pages (Visual)
            // Note: For very large PDFs, lazy loading is better. For now, render all.
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);

                // Use higher scale for sharper text on HiDPI screens
                // 3.0 is usually sufficient for most screens
                const scale = 3.0;
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                canvas.id = `page-${i}`; // Navigation anchor

                // Style for responsiveness
                // We calculate the display width based on the viewport width at scale=1 (approx)
                // or just let CSS handle 100% width, but we need to limit max-width so it doesn't blow up
                // The canvas internal resolution is high (scale 3), CSS scales it down to fit container
                canvas.style.width = '100%';
                canvas.style.height = 'auto';

                readerContent.appendChild(canvas);

                const renderContext = {
                    canvasContext: context,
                    viewport: viewport
                };
                await page.render(renderContext).promise;
            }

            // Restore progress for PDF
            if (fileData.progress) {
                // Small delay to ensure layout is settled
                setTimeout(() => {
                    readerContent.scrollTop = fileData.progress;
                }, 100);
            } else {
                readerContent.scrollTop = 0;
            }

            // 2. Build TOC (Outline)
            const outline = await pdf.getOutline();
            tocList.innerHTML = '';

            if (outline && outline.length > 0) {
                outline.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'toc-item';
                    div.textContent = item.title;
                    div.onclick = async () => {
                        try {
                            let dest = item.dest;
                            if (typeof dest === 'string') {
                                dest = await pdf.getDestination(dest);
                            }
                            if (Array.isArray(dest)) {
                                // The first element is the page ref
                                const ref = dest[0];
                                const pageIndex = await pdf.getPageIndex(ref);
                                // Scroll to page (pageIndex + 1 because our IDs are 1-based)
                                const pageId = `page-${pageIndex + 1}`;
                                const pageEl = document.getElementById(pageId);
                                if (pageEl) {
                                    pageEl.scrollIntoView({ behavior: 'smooth' });
                                    if (window.innerWidth < 800) sidebar.classList.remove('open');
                                }
                            }
                        } catch (err) {
                            console.error('TOC navigation failed:', err);
                        }
                    };
                    tocList.appendChild(div);
                });
            } else {
                // Fallback TOC: Page 1, Page 2...
                for (let i = 1; i <= pdf.numPages; i++) {
                    const div = document.createElement('div');
                    div.className = 'toc-item';
                    div.textContent = `第 ${i} 页`;
                    div.onclick = () => {
                        document.getElementById(`page-${i}`).scrollIntoView({ behavior: 'smooth' });
                        if (window.innerWidth < 800) sidebar.classList.remove('open');
                    };
                    tocList.appendChild(div);
                }
            }

        } catch (error) {
            console.error(error);
            alert('PDF 加载失败: ' + error.message);
            switchView('bookstore');
        }
    }

    function renderLibrary() {
        const dynamicCards = document.querySelectorAll('.book-card.dynamic-book');
        dynamicCards.forEach(c => c.remove());

        // Fetch from Cloud
        const query = Bmob.Query("Books");
        query.order("-lastRead");
        query.find().then(books => {

            books.forEach(book => {
                const card = document.createElement('div');
                card.className = 'book-card dynamic-book';
                card.innerHTML = `
                    <div class="delete-book-btn" title="删除">×</div>
                    <div class="book-cover" style="background-color: #f7f5f0; color: #8c8270; font-size: 2rem;">
                        ${book.title.substring(0, 1)}
                    </div>
                    <div class="card-title">${book.title}</div>
                    <div class="card-meta">Cloud Sync</div>
                `;

                // Open Book (Hybrid Check)
                card.addEventListener('click', async (e) => {
                    if (e.target.classList.contains('delete-book-btn')) return;

                    card.style.opacity = '0.5'; // Visual feedback

                    try {
                        // 1. Check Local Cache
                        let localData = await ReaderDB.getFile(book.fileName);

                        if (!localData) {
                            console.log('Local miss, downloading from cloud:', book.fileUrl);
                            // 2. Download if missing
                            // Note: Bmob file url might need https prefix if missing
                            const response = await fetch(book.fileUrl);
                            const arrayBuffer = await response.arrayBuffer();

                            localData = {
                                fileName: book.fileName,
                                title: book.title,
                                type: book.type,
                                content: arrayBuffer,
                                lastRead: Date.now(),
                                progress: book.progress || 0,
                                cloudId: book.objectId
                            };
                            await ReaderDB.saveFile(localData);
                        } else {
                            // Update local meta just in case
                            localData.cloudId = book.objectId;
                            localData.progress = book.progress || localData.progress; // Sync progress from cloud if larger? Or Trust cloud?
                            // Let's trust cloud progress for now if we want sync functionality
                        }

                        // Load
                        if (localData.fileName.endsWith('.pdf')) {
                            loadPdfBook(localData);
                        } else {
                            const text = decodeText(localData.content);
                            loadBook({ ...localData, content: text });
                        }

                    } catch (err) {
                        alert('打开书籍失败: ' + err.message);
                    } finally {
                        card.style.opacity = '1';
                    }
                });

                // Delete Book (Cloud + Local)
                card.querySelector('.delete-book-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`确定要从云端删除 "${book.title}" 吗？(本地缓存也会被清除)`)) {
                        // Delete Remote
                        const q = Bmob.Query('Books');
                        q.destroy(book.objectId).then(async () => {
                            // Delete Local
                            await ReaderDB.deleteFile(book.fileName);
                            renderLibrary();
                        }).catch(err => {
                            alert('删除失败:' + err.message);
                        });
                    }
                });

                bookGrid.appendChild(card);
            });

        }).catch(err => {
            console.error('Fetch books failed', err);
            // Optionally render fallback local books here if offline
        });
    }

    // --- Blog Logic ---
    const blogEditor = document.getElementById('blog-editor');
    const newPostBtn = document.getElementById('new-post-btn');
    const cancelPostBtn = document.getElementById('cancel-post-btn');
    const savePostBtn = document.getElementById('save-post-btn');
    const blogFeed = document.getElementById('blog-feed');
    const titleInput = document.getElementById('post-title-input');
    const contentInput = document.getElementById('post-content-input');

    // State for editing
    let editingPostId = null;

    newPostBtn.addEventListener('click', () => {
        editingPostId = null; // Clear edit mode
        titleInput.value = '';
        contentInput.value = '';
        blogFeed.classList.add('hidden');
        blogEditor.classList.remove('hidden');
        titleInput.focus();
    });

    cancelPostBtn.addEventListener('click', () => {
        blogEditor.classList.add('hidden');
        blogFeed.classList.remove('hidden');
        editingPostId = null;
    });

    savePostBtn.addEventListener('click', async () => {
        const title = titleInput.value.trim();
        const content = contentInput.value.trim();
        if (!title || !content) return;

        // Visual feedback
        savePostBtn.textContent = '发布中...';
        savePostBtn.disabled = true;

        try {
            const query = Bmob.Query('Posts');

            if (editingPostId) {
                // Update existing
                const post = await query.get(editingPostId);
                post.set('title', title);
                post.set('content', content);
                await post.save();
            } else {
                // Create new
                query.set("title", title);
                query.set("content", content);
                query.set("date", new Date().toLocaleDateString());
                await query.save();
            }

            titleInput.value = '';
            contentInput.value = '';
            editingPostId = null;
            blogEditor.classList.add('hidden');
            blogFeed.classList.remove('hidden');
            renderBlogList(); // Reload from cloud

        } catch (error) {
            console.error('Bmob save error:', error);
            alert('发布失败: ' + error.message);
        } finally {
            savePostBtn.textContent = '发布';
            savePostBtn.disabled = false;
        }
    });

    function renderBlogList() {
        // Clear previous view
        blogFeed.className = 'blog-feed';
        blogFeed.innerHTML = '<div class="loading-indicator">加载文章中...</div>';

        const query = Bmob.Query("Posts");
        query.order("-createdAt"); // Newest first
        query.find().then(posts => {
            blogFeed.innerHTML = ''; // Clear loading

            if (posts.length === 0) {
                blogFeed.innerHTML = '<div style="text-align:center;color:#999;margin-top:2rem;">暂无文章，点击右上角"写博文"开始创作 (Bmob Cloud)</div>';
                return;
            }

            const listContainer = document.createElement('div');
            listContainer.className = 'blog-list';

            posts.forEach(post => {
                const el = document.createElement('div');
                el.className = 'post-item-summary';
                el.innerHTML = `
                    <div class="post-summary-title">${post.title}</div>
                    <div class="post-summary-date">${post.date || post.createdAt}</div>
                `;
                el.addEventListener('click', () => renderBlogPost(post));
                listContainer.appendChild(el);
            });
            blogFeed.appendChild(listContainer);
        }).catch(err => {
            console.error(err);
            blogFeed.innerHTML = '<div style="color:red;text-align:center;">加载失败，请检查网络或密钥配置</div>';
        });
    }

    function renderBlogPost(post) {
        blogFeed.className = 'blog-feed-detail';
        blogFeed.innerHTML = `
            <div class="blog-detail-actions">
                <button class="btn-secondary" id="back-list-btn">← 返回列表</button>
            </div>
            <article class="blog-article">
                <h1 class="article-title">${post.title}</h1>
                <div class="blog-detail-meta">
                    ${post.date}
                    <div style="float:right;">
                        <button class="btn-secondary" id="edit-post-btn" style="font-size:0.8rem; padding: 0.2rem 0.5rem; margin-right: 0.5rem;">编辑</button>
                        <button class="delete-btn-corner" id="delete-post-btn">删除</button>
                    </div>
                </div>
                <div class="article-content">${post.content.replace(/\n/g, '<br>')}</div>
            </article>
        `;

        document.getElementById('back-list-btn').addEventListener('click', () => {
            renderBlogList();
        });

        document.getElementById('edit-post-btn').addEventListener('click', () => {
            editingPostId = post.objectId; // Bmob ID
            titleInput.value = post.title;
            contentInput.value = post.content;
            blogFeed.classList.add('hidden');
            blogEditor.classList.remove('hidden');
        });

        document.getElementById('delete-post-btn').addEventListener('click', () => {
            if (confirm('确定删除?')) {
                const query = Bmob.Query('Posts');
                query.destroy(post.objectId).then(res => {
                    renderBlogList();
                }).catch(err => {
                    alert('删除失败: ' + err.message);
                });
            }
        });
    }

    // --- Text Reader Logic (Same Improved) ---
    const readerContent = document.getElementById('reader-content');
    const navBookTitle = document.getElementById('nav-book-title');
    const sidebar = document.getElementById('sidebar');
    const tocList = document.getElementById('toc-list');
    const saveProgressBtn = document.getElementById('save-progress-btn');

    let currentBookFileName = null; // Track current book

    document.getElementById('toggle-sidebar-btn').addEventListener('click', () => sidebar.classList.toggle('open'));
    document.getElementById('close-sidebar-btn').addEventListener('click', () => sidebar.classList.remove('open'));

    // Save Progress Handler
    saveProgressBtn.addEventListener('click', async () => {
        if (!currentBookFileName) return;

        try {
            const fileData = await ReaderDB.getFile(currentBookFileName);
            if (fileData) {
                fileData.progress = readerContent.scrollTop;
                fileData.lastRead = Date.now();
                if (fileData.cloudId) {
                    const query = Bmob.Query('Books');
                    const bookObj = await query.get(fileData.cloudId);
                    bookObj.set('progress', readerContent.scrollTop);
                    bookObj.set('lastRead', Date.now());
                    await bookObj.save();
                } else {
                    // Try to find by fileName if cloudId missing (legacy compatibility)
                    const q = Bmob.Query('Books');
                    q.equalTo("fileName", "==", currentBookFileName);
                    q.find().then(res => {
                        if (res.length > 0) {
                            const obj = res[0];
                            obj.set('progress', readerContent.scrollTop);
                            obj.set('lastRead', Date.now());
                            obj.save();
                        }
                    });
                }

                // Always save locally too
                await ReaderDB.saveFile(fileData);

                // Visual feedback
                const originalText = saveProgressBtn.textContent;
                saveProgressBtn.textContent = "已保存(Cloud)!";
                setTimeout(() => saveProgressBtn.textContent = originalText, 1500);
            }
        } catch (e) {
            console.error(e);
            alert('保存进度失败');
        }
    });

    async function loadBook(bookData) {
        switchView('reader');
        navBookTitle.innerText = bookData.title;
        currentBookFileName = bookData.fileName; // Set current

        // Update last read of text book
        bookData.lastRead = Date.now();
        if (bookData.fileName !== 'sample.txt') {
            ReaderDB.saveFile(bookData);
        }

        let cleanText = bookData.content.replace(/\r\n/g, '\n');
        const chapterRegex = /(?:^|\n)\s*((?:第[0-9一二三四五六七八九十百千]+[章回卷集部]|Chapter\s?\d+|Section\s?\d+)\s?.*)/g;
        const matches = [...cleanText.matchAll(chapterRegex)];
        let currentChapters = [];
        if (matches.length > 0) {
            if (matches[0].index > 0) currentChapters.push({ title: '开始', content: cleanText.substring(0, matches[0].index), id: 'chapter-0' });
            for (let i = 0; i < matches.length; i++) {
                const next = (i === matches.length - 1) ? cleanText.length : matches[i + 1].index;
                const body = cleanText.substring(matches[i].index, next);
                const lines = body.split('\n');
                currentChapters.push({ title: lines[0].trim(), content: lines.slice(1).join('\n'), id: `ch-${i + 1}` });
            }
        } else {
            // Pagination Fallback
            const pageSize = 5000;
            const pages = Math.ceil(cleanText.length / pageSize);
            for (let i = 0; i < pages; i++) {
                currentChapters.push({ title: `第 ${i + 1} 页`, content: cleanText.substring(i * pageSize, (i + 1) * pageSize), id: `p-${i}` });
            }
        }

        readerContent.innerHTML = '';
        tocList.innerHTML = '';
        currentChapters.forEach(ch => {
            const div = document.createElement('div');
            div.id = ch.id;
            if (ch.title) { const h = document.createElement('h2'); h.className = 'chapter-title-render'; h.innerText = ch.title; div.appendChild(h); }
            const pDiv = document.createElement('div');
            pDiv.innerHTML = ch.content.split('\n').filter(l => l.trim()).map(l => `<p>${l}</p>`).join('');
            div.appendChild(pDiv);
            readerContent.appendChild(div);

            const item = document.createElement('div');
            item.className = 'toc-item';
            item.innerText = ch.title;
            item.onclick = () => { document.getElementById(ch.id).scrollIntoView({ behavior: 'smooth' }); sidebar.classList.remove('open'); };
            tocList.appendChild(item);
        });

        // Restore progress
        if (bookData.progress) {
            readerContent.scrollTop = bookData.progress;
        } else {
            readerContent.scrollTop = 0;
        }
    }

    // Init will be handled by await ReaderDB.init(); at top
});
