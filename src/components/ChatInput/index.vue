<template>
    <div
        v-if="bare"
        ref="inputEl"
        class="wp-agent-chat-input__el"
        :class="{ 'is-empty': isEmpty }"
        contenteditable="true"
        :placeholder="placeholder"
        :style="{ '--inline-el-vertical-align': inlineElementVerticalAlign }"
    ></div>
    <div
        v-else
        ref="chatInputElWrapper"
        class="wp-agent-chat-input-wrapper"
        :class="wrapperClass"
        :style="[wrapperStyle ?? {}, { '--inline-el-vertical-align': inlineElementVerticalAlign }]"
    >
        <div ref="chatInputElContent" class="wp-agent-chat-input">
            <div class="wp-agent-chat-input__main" :class="[isMultiLine ? 'multi' : 'single']">
                <div class="wp-agent-chat-input__el-wrapper">
                    <slot name="header"></slot>
                    <div
                        ref="inputEl"
                        class="wp-agent-chat-input__el"
                        :class="{ 'is-empty': isEmpty }"
                        contenteditable="true"
                        :placeholder="placeholder"
                    ></div>
                    <slot name="footer"></slot>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { CSSProperties } from 'vue';

/**
 * bindInputEvent 中所有可绑定的事件名称，可通过 excludeEvents 按需排除
 */
export type InputEventName =
    | 'input'
    | 'tag-click'
    | 'tribute-enter'
    | 'tribute-replaced'
    | 'focus'
    | 'blur'
    | 'keydown'
    | 'keyup'
    | 'compositionstart'
    | 'compositionend'
    | 'paste'
    | 'cut'
    | 'copy'
    | 'shift-enter'
    | 'ctrl-enter';

/** 输入框内容节点：文本 或 插入的元素组件 */
export type ContentNode = { type: 'text'; value: string } | { type: 'element'; el: HTMLElement };

interface Props {
    modelValue?: string;
    placeholder?: string;
    disabled?: boolean;
    /** 需要跳过绑定的事件列表，对应 InputEventName */
    excludeEvents?: InputEventName[];
    wrapperClass?: string | string[] | Record<string, boolean>;
    wrapperStyle?: CSSProperties;
    /** 仅渲染 contenteditable 元素本身，不渲染外层包裹结构，由父组件自行布局 */
    bare?: boolean;
    /** 插入的行内元素组件的 vertical-align 值，默认 middle */
    inlineElementVerticalAlign?: string;
}

interface Emits {
    (e: 'update:modelValue', value: string): void;
    /** Enter / tribute-enter / shift-enter / ctrl-enter 触发 */
    (e: 'submit'): void;
    (e: 'input', evt: Event): void;
    (e: 'focus', evt: FocusEvent): void;
    (e: 'blur', evt: FocusEvent): void;
    (e: 'keydown', evt: KeyboardEvent): void;
    (e: 'keyup', evt: KeyboardEvent): void;
    (e: 'paste', evt: ClipboardEvent): void;
    (e: 'cut', evt: ClipboardEvent): void;
    (e: 'copy', evt: ClipboardEvent): void;
    (e: 'compositionstart', evt: CompositionEvent): void;
    (e: 'compositionend', evt: CompositionEvent): void;
    (e: 'tag-click', evt: Event): void;
    (e: 'tribute-replaced', evt: Event): void;
}

const props = withDefaults(defineProps<Props>(), {
    modelValue: '',
    placeholder: '输入问题',
    disabled: false,
    excludeEvents: () => [],
    wrapperClass: undefined,
    wrapperStyle: undefined,
    bare: false,
    inlineElementVerticalAlign: 'middle',
});

const emit = defineEmits<Emits>();

const chatInputElWrapper = ref<HTMLDivElement | null>(null);
const chatInputContentEl = ref<HTMLDivElement | null>(null);
const inputEl = ref<HTMLDivElement | null>(null);

const isMultiLine = ref(false);
const isEmpty = ref(true);

// 仅用于保护 submit 不在输入法组合中途触发，属于 UI 正确性，非业务逻辑
let isCompositioning = false;

/**
 * 点击 contenteditable="false" 的行内元素时，用原生 Selection API 将其选中，
 * 呈现浏览器默认的蓝色高亮选中效果。
 */
const handleClickInInput = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target !== inputEl.value && target.getAttribute('contenteditable') === 'false') {
        const selection = window.getSelection();
        if (selection) {
            const range = document.createRange();
            range.selectNode(target);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }
};

const LINE_HEIGHT = 26;

const getPlainText = (el: HTMLElement) => el.innerText || el.textContent || '';

/**
 * 递归遍历节点，将 contenteditable="false" 的元素识别为 element 节点，
 * 其余提取为 text 节点，忽略空文本和 <br>。
 */
const extractContent = (node: Element | HTMLElement): ContentNode[] => {
    const result: ContentNode[] = [];
    node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent ?? '';
            if (text) result.push({ type: 'text', value: text });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as HTMLElement;
            if (el.getAttribute('contenteditable') === 'false') {
                result.push({ type: 'element', el });
            } else if (el.tagName !== 'BR') {
                // div/span 等包裹层，递归提取内部文本
                result.push(...extractContent(el));
            }
        }
    });
    return result;
};

/**
 * 同步空状态：innerText 为空或仅含 <br> 产生的换行符时视为空
 * 用 class 驱动 placeholder 显示，解决 CSS :empty 无法处理残留节点的问题
 */
const syncEmptyState = () => {
    if (!inputEl.value) return;
    const text = inputEl.value.innerText ?? '';
    isEmpty.value = text === '' || text === '\n';
};

const checkMultiLine = () => {
    if (!inputEl.value) return;
    isMultiLine.value = inputEl.value.scrollHeight > LINE_HEIGHT + 10;
};

// ─── Vue 组件渲染器注册表（供外部注册，undo 不参与）──────────────────────

/** key: data-vc-type 值，value: 挂载函数 */
const vcRenderers = new Map<string, (el: HTMLElement) => void>();

// ─── 自定义撤销栈 ────────────────────────────────────────────────────────

type UndoEntry = { html: string; cursor: number };
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
const MAX_UNDO = 50;

/**
 * 获取光标相对 inputEl 起点的字符偏移量。
 * 文本节点每个字符计 1，contenteditable="false" 元素整体计 1。
 * 返回 -1 表示无法获取（无焦点或光标不在 inputEl 内）。
 */
const getCursorOffset = (): number => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !inputEl.value) return -1;
    const range = sel.getRangeAt(0);
    if (!inputEl.value.contains(range.startContainer) && range.startContainer !== inputEl.value) return -1;

    const countTo = (node: Node, endNode: Node, endOffset: number): { count: number; found: boolean } => {
        let count = 0;
        const children = node.childNodes;
        for (let i = 0; i < children.length; i++) {
            if (node === endNode && i === endOffset) return { count, found: true };
            const child = children[i];
            if (child.nodeType === Node.TEXT_NODE) {
                if (child === endNode) return { count: count + endOffset, found: true };
                count += (child as Text).length;
            } else if ((child as HTMLElement).getAttribute?.('contenteditable') === 'false') {
                count += 1;
            } else {
                if (child === endNode || child.contains(endNode)) {
                    const r = countTo(child, endNode, endOffset);
                    return { count: count + r.count, found: r.found };
                }
                const countAll = (n: Node): number => {
                    let c = 0;
                    n.childNodes.forEach(ch => {
                        if (ch.nodeType === Node.TEXT_NODE) c += (ch as Text).length;
                        else if ((ch as HTMLElement).getAttribute?.('contenteditable') === 'false') c += 1;
                        else c += countAll(ch);
                    });
                    return c;
                };
                count += countAll(child);
            }
        }
        if (node === endNode && children.length === endOffset) return { count, found: true };
        return { count, found: false };
    };

    return countTo(inputEl.value, range.startContainer, range.startOffset).count;
};

/**
 * 将光标定位到指定字符偏移量处。
 * 规则与 getCursorOffset 对称：文本字符计 1，contenteditable="false" 元素计 1。
 * charOffset < 0 时退化为定位到末尾。
 */
/** 在 root 内按字符偏移量查找 DOM 位置（text 节点按字符数，contenteditable=false 节点算 1 个单位） */
const findDomPosition = (root: HTMLElement, charOffset: number): { node: Node; offset: number } | null => {
    let remaining = charOffset;
    const walk = (node: Node): { node: Node; offset: number } | null => {
        const children = node.childNodes;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.nodeType === Node.TEXT_NODE) {
                const len = (child as Text).length;
                if (remaining <= len) return { node: child, offset: remaining };
                remaining -= len;
            } else if ((child as HTMLElement).getAttribute?.('contenteditable') === 'false') {
                if (remaining === 0) return { node, offset: i };
                remaining -= 1;
                if (remaining === 0) return { node, offset: i + 1 };
            } else {
                const result = walk(child);
                if (result) return result;
            }
        }
        return null;
    };
    return walk(root);
};

const setCursorAtOffset = (charOffset: number) => {
    if (!inputEl.value) return;
    const fallbackToEnd = () => {
        const r = document.createRange();
        r.selectNodeContents(inputEl.value!);
        r.collapse(false);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
    };
    if (charOffset < 0) { fallbackToEnd(); return; }
    const pos = findDomPosition(inputEl.value, charOffset);
    const range = document.createRange();
    if (pos) {
        range.setStart(pos.node, pos.offset);
        range.collapse(true);
    } else {
        range.selectNodeContents(inputEl.value);
        range.collapse(false);
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
};

/** 在 inputEl 内用浏览器原生选区高亮 [startOffset, endOffset) 范围的内容 */
const setSelectionOffsetRange = (startOffset: number, endOffset: number) => {
    if (!inputEl.value) return;
    const startPos = findDomPosition(inputEl.value, startOffset);
    const endPos = findDomPosition(inputEl.value, endOffset);
    if (!startPos || !endPos) {
        setCursorAtOffset(Math.max(startOffset, endOffset));
        return;
    }
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
};

/**
 * 保留 [data-vc-type] 组件节点的壳（清空内部 Vue 渲染 DOM），
 * 用于存快照时保留组件占位，undo 恢复后再重新挂载。
 */
const cleanVcNodes = (html: string): string => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('[data-vc-type]').forEach((el) => {
        el.innerHTML = '';
    });
    return tmp.innerHTML;
};

/** 遍历 inputEl 中的 [data-vc-type] 占位壳，重新挂载对应 Vue 组件 */
const remountVueComponents = () => {
    if (!inputEl.value) return;
    inputEl.value.querySelectorAll<HTMLElement>('[data-vc-type]').forEach((el) => {
        const type = el.getAttribute('data-vc-type');
        if (type && vcRenderers.has(type)) {
            vcRenderers.get(type)!(el);
        }
    });
};


let snapshotPaused = false;

const saveUndoSnapshot = () => {
    if (snapshotPaused) return;
    if (!inputEl.value) return;
    const snap = cleanVcNodes(inputEl.value.innerHTML);
    if (undoStack[undoStack.length - 1]?.html !== snap) {
        undoStack.push({ html: snap, cursor: getCursorOffset() });
        redoStack.length = 0; // 新输入打断 redo 链
        if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
};

// beforeinput 在 DOM 变更前触发，用于在每次文字输入前存快照
const handleBeforeInput = (e: InputEvent) => {
    saveUndoSnapshot();

    // span 被原生选中（非空选区）时，任何输入都先删除 span 并将光标定位到原位
    if (inputEl.value) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (inputEl.value.contains(range.commonAncestorContainer)) {
                const fragment = range.cloneContents();
                const hasNonEditable = fragment.querySelector('[contenteditable="false"]');
                if (hasNonEditable) {
                    if (e.inputType === 'insertText' && e.data) {
                        // 普通字符输入：手动删除 span + 插入字符
                        e.preventDefault();
                        range.deleteContents();
                        const textNode = document.createTextNode(e.data);
                        range.insertNode(textNode);
                        range.setStartAfter(textNode);
                        range.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(range);
                    } else if (e.inputType.startsWith('insert')) {
                        // IME 组合输入等：删除 span，光标定位到原位，让浏览器继续完成输入
                        range.deleteContents();
                        range.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                    emit('update:modelValue', getPlainText(inputEl.value));
                    syncEmptyState();
                    cleanupBrNodes();
                    nextTick(checkMultiLine);
                }
            }
        }
    }
};

// ─── 事件处理函数（纯 emit，不含业务逻辑）────────────────────────────────

/**
 * 清理输入框内紧邻 contenteditable="false" 元素之前的孤立 <br> 节点。
 * 浏览器在删光组件周围文字时会自动插入 <br> 占位，导致组件换行显示。
 */
const cleanupBrNodes = () => {
    if (!inputEl.value) return;
    let changed = false;
    // 反向遍历，避免删除时下标错乱
    const children = Array.from(inputEl.value.childNodes);
    children.forEach((node) => {
        if (node.nodeName !== 'BR') return;
        const next = node.nextSibling;
        // BR 紧邻 contenteditable="false" 节点，或 BR 是最后一个节点且前面有不可编辑元素
        const nextIsNonEditable =
            next && (next as HTMLElement).getAttribute?.('contenteditable') === 'false';
        const isTrailingBr = !next && children.some(
            (n) => (n as HTMLElement).getAttribute?.('contenteditable') === 'false'
        );
        if (nextIsNonEditable || isTrailingBr) {
            node.parentNode?.removeChild(node);
            changed = true;
        }
    });
    if (changed) nextTick(checkMultiLine);
};

const handleInput = (e: Event) => {
    if (!inputEl.value) return;
    emit('update:modelValue', getPlainText(inputEl.value));
    emit('input', e);
    syncEmptyState();
    cleanupBrNodes();
    nextTick(checkMultiLine);
};

const handleTagClick = (e: Event) => {
    emit('tag-click', e);
};

const handleTributeReplaced = (e: Event) => {
    // tribute 替换后需同步更新 modelValue
    if (inputEl.value) {
        emit('update:modelValue', getPlainText(inputEl.value));
        syncEmptyState();
        nextTick(checkMultiLine);
    }
    emit('tribute-replaced', e);
};

const handleFocus = (e: Event) => {
    emit('focus', e as FocusEvent);
};

const handleBlur = (e: Event) => {
    emit('blur', e as FocusEvent);
};

const handleSend = () => {
    if (isCompositioning) return;
    emit('submit');
};

const handleKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;

    // Ctrl+Z / Cmd+Z 触发撤销（含组件还原）
    if ((ke.ctrlKey || ke.metaKey) && ke.code === 'KeyZ' && !ke.shiftKey) {
        ke.preventDefault();
        if (undoStack.length > 0 && inputEl.value) {
            // 将当前状态压入 redoStack，以便反向恢复
            redoStack.push({ html: cleanVcNodes(inputEl.value.innerHTML), cursor: getCursorOffset() });
            const snap = undoStack.pop()!;
            inputEl.value.innerHTML = snap.html;
            remountVueComponents();
            // 光标定位到撤销快照记录的位置（即被恢复内容之后）
            setCursorAtOffset(snap.cursor);
            emit('update:modelValue', getPlainText(inputEl.value));
            syncEmptyState();
            nextTick(checkMultiLine);
        }
        return;
    }

    // Shift+Cmd+Z (Mac) / Ctrl+Y / Shift+Ctrl+Z (Win) 触发重做
    const isRedo =
        (ke.metaKey && ke.shiftKey && ke.code === 'KeyZ') ||
        (ke.ctrlKey && !ke.metaKey && ke.code === 'KeyY') ||
        (ke.ctrlKey && !ke.metaKey && ke.shiftKey && ke.code === 'KeyZ');
    if (isRedo) {
        ke.preventDefault();
        if (redoStack.length > 0 && inputEl.value) {
            // 将当前状态压回 undoStack
            undoStack.push({ html: cleanVcNodes(inputEl.value.innerHTML), cursor: getCursorOffset() });
            const snap = redoStack.pop()!;
            inputEl.value.innerHTML = snap.html;
            remountVueComponents();
            setCursorAtOffset(snap.cursor);
            emit('update:modelValue', getPlainText(inputEl.value));
            syncEmptyState();
            nextTick(checkMultiLine);
        }
        return;
    }

    // Backspace / Delete：光标紧跟在 contenteditable="false" 节点后时，浏览器无法自动删除，需手动处理
    if (ke.key === 'Backspace' || ke.key === 'Delete') {
        const sel = window.getSelection();
        // 处理 range 选区（如通过点击 span 产生的整体选中）：手动删除选区内容
        if (sel && !sel.isCollapsed && sel.rangeCount > 0 && inputEl.value) {
            const range = sel.getRangeAt(0);
            if (inputEl.value.contains(range.commonAncestorContainer)) {
                    ke.preventDefault();
                    saveUndoSnapshot();
                    range.deleteContents();
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    emit('update:modelValue', getPlainText(inputEl.value));
                syncEmptyState();
                cleanupBrNodes();
                nextTick(checkMultiLine);
                return;
            }
        }
        if (ke.key === 'Backspace' && sel && sel.isCollapsed && inputEl.value) {
            const range = sel.getRangeAt(0);
            let prev: Node | null = null;
            if (range.startContainer === inputEl.value) {
                // 光标在 inputEl 子节点边界上
                prev = inputEl.value.childNodes[range.startOffset - 1] ?? null;
            } else if (range.startOffset === 0) {
                // 光标在子节点文本最前，前一个兄弟可能是不可编辑节点
                prev = range.startContainer.previousSibling;
            }
            if (prev && (prev as HTMLElement).getAttribute?.('contenteditable') === 'false') {
                ke.preventDefault();
                saveUndoSnapshot();
                prev.parentNode?.removeChild(prev);
                emit('update:modelValue', getPlainText(inputEl.value));
                syncEmptyState();
                cleanupBrNodes();
                nextTick(checkMultiLine);
                return;
            }
        }
    }

    // Enter 阻止默认换行行为并触发 submit，属于 UI 正确性
    if (ke.key === 'Enter' && !ke.shiftKey && !ke.ctrlKey && !ke.metaKey) {
        ke.preventDefault();
        handleSend();
    }
    emit('keydown', ke);
};

const handleKeyUp = (e: Event) => {
    emit('keyup', e as KeyboardEvent);
};

const handleCompositionstart = (e: Event) => {
    isCompositioning = true;
    emit('compositionstart', e as CompositionEvent);
};

const handleCompositionend = (e: Event) => {
    isCompositioning = false;
    // compositionend 后补一次 input 同步，确保 modelValue 正确
    if (inputEl.value) {
        emit('update:modelValue', getPlainText(inputEl.value));
        syncEmptyState();
    }
    emit('compositionend', e as CompositionEvent);
};

/**
 * 将选区 fragment 序列化为 HTML 字符串：
 * 保留 [data-vc-type] 组件壳（清空内部 Vue 渲染 DOM），以便粘贴时重新挂载。
 */
const serializeFragment = (fragment: DocumentFragment): string => {
    const tmp = document.createElement('div');
    tmp.appendChild(fragment.cloneNode(true));
    tmp.querySelectorAll('[data-vc-type]').forEach((el) => { el.innerHTML = ''; });
    return tmp.innerHTML;
};

/**
 * 将 HTML 字符串插入光标处，并重新挂载其中的 vc 组件。
 */
const insertHtmlAtCursor = (html: string) => {
    if (!inputEl.value) return;
    saveUndoSnapshot();
    const selection = window.getSelection();
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const fragment = document.createDocumentFragment();
    while (tmp.firstChild) fragment.appendChild(tmp.firstChild);

    if (selection && selection.rangeCount > 0 && inputEl.value.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(fragment);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    } else {
        inputEl.value.appendChild(fragment);
    }
    remountVueComponents();
    emit('update:modelValue', getPlainText(inputEl.value));
    syncEmptyState();
    cleanupBrNodes();
    nextTick(checkMultiLine);
};

const handlePaste = (e: Event) => {
    const ce = e as ClipboardEvent;

    // 先派发给使用方：index.vue 里实现了完整的粘贴策略（图片走上传、技能 chip 保留、长度截断），
    // 它接管时会 preventDefault 并自行写入内容，此时必须直接返回。
    // 否则同一份剪贴板内容会被插入两次（表现为复制 1 个字、粘贴出 2 个字）。
    emit('paste', ce);
    if (ce.defaultPrevented) return;

    ce.preventDefault();

    // 优先检测是否含有我们自己写入的组件 HTML（data-vc-type 标记）
    const html = ce.clipboardData?.getData('text/html') || '';
    if (html && html.includes('data-vc-type')) {
        insertHtmlAtCursor(html);
        return;
    }

    // 降级：纯文本粘贴，防止外部样式污染
    const text = ce.clipboardData?.getData('text/plain') || '';
    if (text) {
        document.execCommand('insertText', false, text);
        if (inputEl.value) {
            emit('update:modelValue', getPlainText(inputEl.value));
            syncEmptyState();
            nextTick(checkMultiLine);
        }
    }
};

/** 从 fragment/Element 中递归提取纯文本，跳过 contenteditable="false" 的元素组件 */
const extractPlainText = (node: DocumentFragment | Element): string => {
    let text = '';
    node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent ?? '';
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as HTMLElement;
            if (el.getAttribute('contenteditable') !== 'false') {
                text += extractPlainText(el);
            }
            // contenteditable="false" 的元素组件不参与复制
        }
    });
    return text;
};

const handleCopy = (e: Event) => {
    const ce = e as ClipboardEvent;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        ce.preventDefault();
        const fragment = selection.getRangeAt(0).cloneContents();
        ce.clipboardData?.setData('text/plain', extractPlainText(fragment));
        ce.clipboardData?.setData('text/html', serializeFragment(fragment));
    }
    emit('copy', ce);
};

const handleCut = (e: Event) => {
    const ce = e as ClipboardEvent;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        ce.preventDefault();
        const fragment = range.cloneContents();
        ce.clipboardData?.setData('text/plain', extractPlainText(fragment));
        ce.clipboardData?.setData('text/html', serializeFragment(fragment));
        saveUndoSnapshot(); // 剪切前存快照，保证 Ctrl/Cmd+Z 可恢复
        range.deleteContents(); // 删除选区内容（含元素组件）
        if (inputEl.value) {
            emit('update:modelValue', getPlainText(inputEl.value));
            syncEmptyState();
            nextTick(checkMultiLine);
        }
    }
    emit('cut', ce);
};

const handleShiftEnter = () => {
    handleSend();
};

// ─── 事件绑定 map（excludeEvents 按名称过滤）────────────────────────────

const getEventMap = (): [InputEventName, EventListener][] => [
    ['input', handleInput],
    ['tag-click', handleTagClick],
    ['tribute-enter', handleSend as EventListener],
    ['tribute-replaced', handleTributeReplaced],
    ['focus', handleFocus],
    ['blur', handleBlur],
    ['keydown', handleKeyDown],
    ['keyup', handleKeyUp],
    ['compositionstart', handleCompositionstart],
    ['compositionend', handleCompositionend],
    ['paste', handlePaste],
    ['cut', handleCut],
    ['copy', handleCopy],
    ['shift-enter', handleShiftEnter as EventListener],
    ['ctrl-enter', handleShiftEnter as EventListener]
];

const bindInputEvent = () => {
    if (!inputEl.value) return;
    const excluded = new Set(props.excludeEvents);
    getEventMap().forEach(([name, handler]) => {
        if (!excluded.has(name)) {
            inputEl.value!.addEventListener(name, handler);
        }
    });
};

const unbindInputEvent = () => {
    if (!inputEl.value) return;
    getEventMap().forEach(([name, handler]) => {
        inputEl.value!.removeEventListener(name, handler);
    });
};

onMounted(() => {
    bindInputEvent();
    syncEmptyState();
    inputEl.value?.addEventListener('beforeinput', handleBeforeInput);
    inputEl.value?.addEventListener('click', handleClickInInput);
});

onBeforeUnmount(() => {
    unbindInputEvent();
    inputEl.value?.removeEventListener('beforeinput', handleBeforeInput);
    inputEl.value?.removeEventListener('click', handleClickInInput);
});

// ─── 元素插入（光标位置）────────────────────────────────────────────────

/**
 * 在当前光标位置插入 HTMLElement。
 * 若无有效选区则追加到末尾。
 */
const insertElementAtCursor = (el: HTMLElement) => {
    if (!inputEl.value) return;

    const selection = window.getSelection();
    const inTextarea = selection && selection.rangeCount > 0 && inputEl.value.contains(selection.anchorNode);

    if (!inTextarea) {
        inputEl.value.appendChild(el);
        return;
    }

    const range = selection!.getRangeAt(0);
    range.deleteContents();
    range.insertNode(el);

    // 光标移到插入元素之后
    range.setStartAfter(el);
    range.collapse(true);
    selection!.removeAllRanges();
    selection!.addRange(range);
};

defineExpose({
    chatInputElWrapper,
    chatInputContentEl,
    inputEl,
    focus: () => inputEl.value?.focus(),
    /** 获取结构化内容，包含文本节点与插入的元素组件 */
    getContent: (): ContentNode[] => (inputEl.value ? extractContent(inputEl.value) : []),
    clear: () => {
        if (inputEl.value) {
            inputEl.value.innerHTML = '';
            emit('update:modelValue', '');
            isMultiLine.value = false;
            isEmpty.value = true;
        }
    },
    insertText: (text: string) => {
        if (inputEl.value) {
            inputEl.value.focus();
            document.execCommand('insertText', false, text);
            emit('update:modelValue', getPlainText(inputEl.value));
            syncEmptyState();
            nextTick(checkMultiLine);
        }
    },
    /**
     * 注册 Vue 组件渲染器，undo 恢复 innerHTML 后自动重新挂载。
     * type 对应插入元素的 data-vc-type 属性值。
     */
    registerVcRenderer: (type: string, renderer: (el: HTMLElement) => void) => {
        vcRenderers.set(type, renderer);
    },
    /** 手动强制存一次 undo 快照，绕过 pauseSnapshot 标志（用于原子插入前标记恢复点） */
    saveSnapshot: () => {
        if (!inputEl.value) return;
        const snap = cleanVcNodes(inputEl.value.innerHTML);
        if (undoStack[undoStack.length - 1]?.html !== snap) {
            undoStack.push({ html: snap, cursor: getCursorOffset() });
            redoStack.length = 0;
            if (undoStack.length > MAX_UNDO) undoStack.shift();
        }
    },
    /** 暂停 undo 快照收集（原子插入开始前调用） */
    pauseSnapshot: () => {
        snapshotPaused = true;
    },
    /** 恢复 undo 快照收集（原子插入结束后调用） */
    resumeSnapshot: () => {
        snapshotPaused = false;
    },
    /**
     * 在光标位置插入任意 HTMLElement（如 @标签、文件 chip 等）。
     * 调用前可通过 createApp / render 将 Vue 组件挂载到元素上再传入。
     * 插入后光标自动移到元素右侧。
     */
    insertElement: (el: HTMLElement) => {
        if (!inputEl.value) return;
        saveUndoSnapshot(); // 插入前存快照，保证 Ctrl+Z 可恢复
        inputEl.value.focus();
        insertElementAtCursor(el);
        emit('update:modelValue', getPlainText(inputEl.value));
        syncEmptyState();
        nextTick(checkMultiLine);
    },
    /** 用浏览器原生选区高亮 [startOffset, endOffset) 范围的内容 */
    setSelectionOffsetRange
});
</script>

<style scoped lang="scss">
.wp-agent-chat-input-wrapper {
    max-width: 800px;
    min-width: 400px;
    width: 100%;
    margin: 0 auto;
}

.wp-agent-chat-input {
    container-type: inline-size;
}

.wp-agent-chat-input__main {
    position: relative;
    background-color: #ffffff;
    border-radius: 12px;
    border: 1px solid transparent;
    padding: 0;
    z-index: 1;
    box-shadow: 0 0 24px 0 rgba(0, 0, 0, 0.05);

    &:hover {
        border-color: #171717;
    }

    &:focus-within {
        border-color: #171717;
    }

    &.single {
        display: flex;
        align-items: center;

        .wp-agent-chat-input__el-wrapper {
            display: inline-block;
            flex: 1;
        }

        .wp-agent-chat-input__el {
            height: 26px;
        }
    }
}

.wp-agent-chat-input__el-wrapper {
    position: relative;
    padding: 11px 12px 11px 16px;
}

.wp-agent-chat-input__el {
    position: relative;
    box-sizing: border-box;
    width: calc(100% - 4px);
    resize: none;
    outline: none;
    word-break: break-all;
    font-weight: 400;
    color: #030b1a;
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 24px;
    cursor: text;
    margin: 2px 0;

    &[contenteditable='true'] {
        caret-color: #258aff;
        min-height: var(--chat-input-min-height, 48px);
        max-height: 128px;
        overflow-y: auto;
    }

    // 插入的元素组件统一行内展示，避免撑满整行
    :deep([contenteditable='false']) {
        display: inline-block;
        vertical-align: var(--inline-el-vertical-align, middle);
    }

    &.is-empty::before {
        content: attr(placeholder);
        position: absolute;
        top: 0;
        left: 0;
        color: #818999;
        height: 24px;
        line-height: 24px;
        pointer-events: none;
        user-select: none;
    }

    &::-webkit-scrollbar {
        background: transparent;
        width: 5px;
    }

    &::-webkit-scrollbar-thumb {
        background: #d9d9d9;
        border-radius: 5px;
        cursor: pointer;
    }
}
</style>
