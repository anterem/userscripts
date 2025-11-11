// ==UserScript==
// @name         Regex Search
// @namespace    https://github.com/anterem/userscripts
// @match        *://*/*
// @version      2.5
// @description  Search and highlight regex matches on webpage. Uses CSS Custom Highlight API.
// @run-at       context-menu
// @grant        GM.setValue
// @grant        GM.getValue
// @updateURL    https://raw.githubusercontent.com/anterem/userscripts/main/regex-search/regex-search.meta.js
// @downloadURL  https://raw.githubusercontent.com/anterem/userscripts/main/regex-search/regex-search.user.js
// ==/UserScript==

(() => {
    "use strict";
    if (window.__regexSearch_popup__) return;

    // Setup highlight styles
    document.head.insertAdjacentHTML(
        "beforeend",
        `
    <style>
      ::highlight(regex-search-all) {
        color: black;
        background-color: gold;
      }
      ::highlight(regex-search-current) {
        color: white;
        background-color: tomato;
      }
    </style>
  `,
    );

    // Create popup container
    const container = Object.assign(document.createElement("div"), {
        style: "position:fixed;top:10px;right:10px;z-index:5000002;",
    });
    document.documentElement.appendChild(container);
    window.__regexSearch_popup__ = container;
    const shadow = container.attachShadow({ mode: "open" });
    shadow.innerHTML = `
    <style>
      :host { all: initial; --font-sans: Inter, Roboto, 'Helvetica Neue', 'Arial Nova', 'Nimbus Sans', Arial, sans-serif;  }
      #popup { width:300px; background:white; border:3px solid black; }
      #top { display:flex; align-items:flex-start; }
      #drag { flex:1 1 auto; height:0.4rem; background:black; cursor:move; }
      #content { padding:0.6rem 0.6rem 0.3rem; }
      #match-count { margin-left:0.3rem; font:600 0.9rem var(--font-sans); }
      textarea { width:100%; margin-bottom:0.3rem; font:600 1rem monospace; border:3px solid black; resize:vertical; box-sizing:border-box; }
      button { padding:0.2rem 0.6rem; color:white; background:black; font:600 0.8rem var(--font-sans); border:none; }
      #popup { position:relative; }
    </style>
    <div id="popup">
      <div id="top">
        <div id="drag"></div>
        <button id="close">✖</button>
      </div>
      <div id="content">
        <textarea id="input" placeholder="Enter regex patterns (one per line)" rows="3" maxlength="500" spellcheck="false"></textarea>
        <button id="search">Search</button>
        <button id="prev">▲</button>
        <button id="next">▼</button>
        <span id="match-count"></span>
      </div>
    </div>
  `;

    // Make popup draggable
    let dx = 0,
        dy = 0,
        moving = false;
    const dragHandle = shadow.getElementById("drag");
    let onMove, onUp;

    dragHandle.addEventListener(
        "mousedown",
        (e) => {
            moving = true;
            dx = e.clientX - container.offsetLeft;
            dy = e.clientY - container.offsetTop;
            e.preventDefault();

            onMove = (e) => {
                if (!moving) return;
                container.style.left = e.clientX - dx + "px";
                container.style.top = e.clientY - dy + "px";
            };
            onUp = () => {
                moving = false;
                window.removeEventListener("mousemove", onMove, {
                    passive: true,
                });
                window.removeEventListener("mouseup", onUp, { passive: true });
            };
            window.addEventListener("mousemove", onMove, { passive: true });
            window.addEventListener("mouseup", onUp, { passive: true });
        },
        { passive: true },
    );

    const elById = (id) => shadow.getElementById(id);
    const [input, searchBtn, prevBtn, nextBtn, closeBtn, countEl] = [
        "input",
        "search",
        "prev",
        "next",
        "close",
        "match-count",
    ].map(elById);

    // Save and load queries for each site
    const host = location.hostname;
    (async () => {
        const history = await GM.getValue("regexHistory", []);
        const entry = history.find((e) => e.host === host);
        if (entry) input.value = entry.regex;
    })();

    const saveRegex = async (val) => {
        if (!val.trim()) return;
        let history = await GM.getValue("regexHistory", []);
        history = [
            { host, regex: val },
            ...history.filter((e) => e.host !== host),
        ].slice(0, 20);
        GM.setValue("regexHistory", history);
    };

    function isSkippable(el) {
        if (!el) return false;
        if (el.closest("script,style,noscript,template")) return true;
        if (el.closest("[hidden],[aria-hidden='true']")) return true;
        if (container.contains(el)) return true;
        return false;
    }

    // Search for matches
    let matches = [],
        current = -1;

    async function search() {
        await saveRegex(input.value);
        matches = [];
        current = -1;
        countEl.textContent = "";

        // Clear existing highlights using clear as delete does not reliably repaint
        CSS.highlights.clear();

        const patterns = input.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        if (!patterns.length) return (countEl.textContent = "");

        let combined;
        try {
            const parts = patterns.map((p) => `(?:${p})`);
            combined = new RegExp(parts.join("|"), "g");
        } catch (e) {
            console.warn("Invalid regex:", e);
            return (countEl.textContent = "Invalid regex");
        }

        const regexes = input.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((p) => {
                try {
                    return new RegExp(p, "g");
                } catch {
                    console.warn("Invalid regex:", p);
                }
            })
            .filter(Boolean);
        if (!regexes.length) return (countEl.textContent = "");

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (n) =>
                    isSkippable(n.parentElement)
                        ? NodeFilter.FILTER_REJECT
                        : NodeFilter.FILTER_ACCEPT,
            },
        );

        for (let node; (node = walker.nextNode()); ) {
            const text = node.textContent;
            if (text.length < 2) continue;

            combined.lastIndex = 0;
            let match;
            while ((match = combined.exec(text)) !== null) {
                const range = document.createRange();
                range.setStart(node, match.index);
                range.setEnd(node, match.index + match[0].length);
                matches.push(range);
                if (match[0].length === 0) combined.lastIndex++;
            }
        }

        if (!matches.length) countEl.textContent = "No matches";

        // Create highlights
        const allHighlights = new Highlight();
        for (const r of matches) allHighlights.add(r);
        CSS.highlights.set("regex-search-all", allHighlights);
        current = 0;
        highlight();
    }

    // Highlight and scroll to current match
    function highlight() {
        CSS.highlights.delete("regex-search-current");

        if (matches[current]) {
            const currentHighlight = new Highlight(matches[current]);
            CSS.highlights.set("regex-search-current", currentHighlight);
            const rect = matches[current].getBoundingClientRect();
            const absoluteTop = window.pageYOffset + rect.top;
            const middle = absoluteTop - window.innerHeight / 2;
            window.scrollTo({ top: middle, behavior: "smooth" });
        }

        countEl.textContent = `${current + 1} / ${matches.length}`;
    }

    const step = (dir) => {
        if (matches.length) {
            current = (current + dir + matches.length) % matches.length;
            highlight();
        }
    };

    searchBtn.onclick = search;
    nextBtn.onclick = () => step(1);
    prevBtn.onclick = () => step(-1);
    closeBtn.onclick = () => {
        container.remove();
        window.__regexSearch_popup__ = null;
    };
})();
