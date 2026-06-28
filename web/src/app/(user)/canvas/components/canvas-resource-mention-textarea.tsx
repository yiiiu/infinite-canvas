"use client";

import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, ForwardedRef, KeyboardEvent, MouseEvent, PointerEvent, TextareaHTMLAttributes, WheelEvent } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

type MentionState = {
    start: number;
    query: string;
};

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
    value: string;
    references: CanvasResourceReference[];
    onChange: (value: string) => void;
    onSubmit?: () => void;
    containerClassName?: string;
    highlightLabels?: boolean;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function CanvasResourceMentionTextarea({ value, references, onChange, onSubmit, onKeyDown, className, containerClassName, style, highlightLabels = true, ...props }, forwardedRef) {
    if (highlightLabels) {
        return <CanvasResourceMentionEditor value={value} references={references} onChange={onChange} onSubmit={onSubmit} onKeyDown={onKeyDown} className={className} containerClassName={containerClassName} style={style} textareaProps={props} />;
    }

    return <CanvasResourceMentionTextareaInput value={value} references={references} onChange={onChange} onSubmit={onSubmit} onKeyDown={onKeyDown} className={className} containerClassName={containerClassName} style={style} textareaProps={props} forwardedRef={forwardedRef} />;
});

function CanvasResourceMentionTextareaInput({ value, references, onChange, onSubmit, onKeyDown, className, containerClassName, style, textareaProps: props, forwardedRef }: { value: string; references: CanvasResourceReference[]; onChange: (value: string) => void; onSubmit?: () => void; onKeyDown?: TextareaHTMLAttributes<HTMLTextAreaElement>["onKeyDown"]; className?: string; containerClassName?: string; style?: CSSProperties; textareaProps: TextareaHTMLAttributes<HTMLTextAreaElement>; forwardedRef: ForwardedRef<HTMLTextAreaElement> }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        const activeReferences = references.filter((item) => item.active);
        if (!query) return activeReferences;
        return activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, references]);

    const updateValue = (next: string, selectionStart?: number) => {
        onChange(next);
        if (typeof selectionStart !== "number") return;
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(selectionStart, selectionStart);
        });
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const syncMention = (nextValue: string, cursor: number) => {
        const prefix = nextValue.slice(0, cursor);
        const match = /(^|\s)@([^\s@]*)$/.exec(prefix);
        if (!match || !references.some((item) => item.active)) {
            closeMention();
            return;
        }
        setMention({ start: cursor - match[2].length - 1, query: match[2] });
        setActiveIndex(0);
    };

    const insertReference = (reference: CanvasResourceReference) => {
        if (!mention) return;
        const textarea = textareaRef.current;
        const end = textarea?.selectionStart ?? value.length;
        const insertText = `${reference.label} `;
        const next = `${value.slice(0, mention.start)}${insertText}${value.slice(end)}`;
        closeMention();
        updateValue(next, mention.start + insertText.length);
    };

    const mergedStyle = {
        ...(style || {}),
        color: style?.color,
        caretColor: style?.color || theme.node.text,
    } as CSSProperties;
    const menu = mention && candidates.length && textareaRef.current ? <MentionMenu textarea={textareaRef.current} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null;

    return (
        <div className={`relative h-full w-full cursor-text ${containerClassName || ""}`} data-canvas-no-zoom>
            <textarea
                {...props}
                ref={(node) => {
                    textareaRef.current = node;
                    if (typeof forwardedRef === "function") forwardedRef(node);
                    else if (forwardedRef) forwardedRef.current = node;
                }}
                value={value}
                className={className}
                style={mergedStyle}
                onChange={(event) => {
                    const next = event.target.value;
                    onChange(next);
                    syncMention(next, event.target.selectionStart);
                }}
                onSelect={(event) => {
                    props.onSelect?.(event);
                }}
                onKeyUp={(event) => {
                    props.onKeyUp?.(event);
                }}
                onPointerUp={(event) => {
                    props.onPointerUp?.(event);
                }}
                onKeyDown={(event) => {
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if (event.key === "Enter" && onSubmit && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    onKeyDown?.(event);
                }}
                onScroll={(event) => {
                    props.onScroll?.(event);
                }}
                onBlur={(event) => {
                    window.setTimeout(closeMention, 120);
                    props.onBlur?.(event);
                }}
            />
            {menu}
        </div>
    );
}

function CanvasResourceMentionEditor({ value, references, onChange, onSubmit, onKeyDown, className, containerClassName, style, textareaProps }: { value: string; references: CanvasResourceReference[]; onChange: (value: string) => void; onSubmit?: () => void; onKeyDown?: TextareaHTMLAttributes<HTMLTextAreaElement>["onKeyDown"]; className?: string; containerClassName?: string; style?: CSSProperties; textareaProps: TextareaHTMLAttributes<HTMLTextAreaElement> }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement | null>(null);
    const composingRef = useRef(false);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const activeReferences = useMemo(() => references.filter((item) => item.active), [references]);
    const activeLabels = useMemo(() => Array.from(new Set(activeReferences.map((item) => item.label))).sort((a, b) => b.length - a.length), [activeReferences]);
    const editorClassName = `${className || ""} cursor-text whitespace-pre-wrap break-words`;
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        if (!query) return activeReferences;
        return activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [activeReferences, mention]);

    useLayoutEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (document.activeElement === editor && serializeMentionEditor(editor) === value) return;
        renderEditorValue(editor, value, activeLabels);
    }, [activeLabels, value]);

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const syncMention = () => {
        const text = textBeforeCaret(editorRef.current);
        const match = /(^|\s)@([^\s@]*)$/.exec(text);
        if (!match || !activeReferences.length) {
            closeMention();
            return;
        }
        setMention({ start: 0, query: match[2] });
        setActiveIndex(0);
    };

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        onChange(serializeMentionEditor(editor));
        if (!composingRef.current) syncMention();
    };

    const insertReference = (reference: CanvasResourceReference) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        removeActiveEditorMention(editor);
        const selection = window.getSelection();
        const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const range = selectedRange && editor.contains(selectedRange.startContainer) ? selectedRange : null;
        const chip = createMentionChip(reference.label);
        const space = document.createTextNode(" ");
        if (range) {
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        } else {
            editor.append(chip, space);
            placeCaretAfter(space);
        }
        closeMention();
        onChange(serializeMentionEditor(editor));
    };

    const menu = mention && candidates.length && editorRef.current ? <MentionMenu textarea={editorRef.current} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null;

    return (
        <div className={`relative h-full w-full cursor-text ${containerClassName || ""}`} data-canvas-no-zoom>
            {!value ? <div className={`${editorClassName} pointer-events-none absolute inset-0 opacity-45`} style={{ ...style, color: style?.color || theme.node.text }}>{textareaProps.placeholder}</div> : null}
            <div
                ref={editorRef}
                role="textbox"
                aria-multiline="true"
                contentEditable
                suppressContentEditableWarning
                className={editorClassName}
                style={{ ...style, color: style?.color || theme.node.text, caretColor: style?.color || theme.node.text }}
                onCompositionStart={() => {
                    composingRef.current = true;
                }}
                onCompositionEnd={() => {
                    composingRef.current = false;
                    syncFromEditor();
                }}
                onInput={syncFromEditor}
                onPaste={(event) => {
                    event.preventDefault();
                    insertPlainText(event.clipboardData.getData("text/plain"));
                    requestAnimationFrame(syncFromEditor);
                }}
                onKeyDown={(event) => {
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if (event.key === "Enter" && onSubmit && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    onKeyDown?.(event as unknown as KeyboardEvent<HTMLTextAreaElement>);
                    requestAnimationFrame(syncMention);
                }}
                onBlur={(event) => {
                    window.setTimeout(closeMention, 120);
                    textareaProps.onBlur?.(event as unknown as FocusEvent<HTMLTextAreaElement>);
                }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    textareaProps.onMouseDown?.(event as unknown as MouseEvent<HTMLTextAreaElement>);
                }}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    textareaProps.onPointerDown?.(event as unknown as PointerEvent<HTMLTextAreaElement>);
                }}
                onWheel={(event) => textareaProps.onWheel?.(event as unknown as WheelEvent<HTMLTextAreaElement>)}
            />
            {menu}
        </div>
    );
}

function renderEditorValue(editor: HTMLDivElement, value: string, labels: string[]) {
    editor.textContent = "";
    if (!value) return;
    if (!labels.length) {
        editor.append(document.createTextNode(value));
        return;
    }
    const pattern = new RegExp(`(${labels.map(escapeRegExp).join("|")})`, "g");
    value.split(pattern).forEach((part) => {
        if (!part) return;
        editor.append(labels.includes(part) ? createMentionChip(part) : document.createTextNode(part));
    });
}

function createMentionChip(label: string) {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.canvasMentionLabel = label;
    chip.textContent = label;
    chip.className = "inline-flex items-center rounded-[4px] px-0 text-[#2f80ff] align-baseline";
    Object.assign(chip.style, {
        background: "rgba(47,128,255,.16)",
        boxShadow: "0 0 0 1px rgba(47,128,255,.24)",
        color: "#2f80ff",
        lineHeight: "inherit",
    } satisfies CSSProperties);
    return chip;
}

function serializeMentionEditor(editor: HTMLDivElement) {
    return serializeMentionNodes(editor.childNodes);
}

function serializeMentionNodes(nodes: NodeListOf<ChildNode> | ChildNode[]) {
    let result = "";
    nodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            result += node.textContent || "";
            return;
        }
        if (!(node instanceof HTMLElement)) return;
        const label = node.dataset.canvasMentionLabel;
        if (label) result += label;
        else if (node.tagName === "BR") result += "\n";
        else if (node.tagName === "DIV" || node.tagName === "P") {
            result += serializeMentionNodes(Array.from(node.childNodes));
            result += "\n";
        } else result += serializeMentionNodes(Array.from(node.childNodes));
    });
    return result.replace(/\u00a0/g, " ").replace(/\n$/, "");
}

function textBeforeCaret(editor: HTMLDivElement | null) {
    if (!editor) return "";
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    if (!editor.contains(range.startContainer)) return "";
    range.setStart(editor, 0);
    return range.toString();
}

function removeActiveEditorMention(editor: HTMLDivElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;
    const text = textBeforeCaret(editor);
    const match = /(^|\s)@([^\s@]*)$/.exec(text);
    if (!match) return;
    range.setStart(range.startContainer, Math.max(0, range.startOffset - match[2].length - 1));
    range.deleteContents();
}

function placeCaretAfter(node: Node) {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function insertPlainText(text: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    placeCaretAfter(node);
}

function MentionMenu({ textarea, references, activeIndex, theme, onSelect }: { textarea: HTMLElement; references: CanvasResourceReference[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (reference: CanvasResourceReference) => void }) {
    const selectedRef = useRef(false);
    const rect = textarea.getBoundingClientRect();
    const boundary = textarea.closest(".ant-modal-content")?.getBoundingClientRect() || { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
    const menuWidth = 256;
    const maxMenuHeight = 224;
    const gap = 6;
    const left = clamp(rect.left, boundary.left + 8, boundary.right - menuWidth - 8);
    const showAbove = rect.bottom + gap + maxMenuHeight > boundary.bottom && rect.top - gap - maxMenuHeight >= boundary.top;
    const top = clamp(showAbove ? rect.top - gap - maxMenuHeight : rect.bottom + gap, boundary.top + 8, boundary.bottom - maxMenuHeight - 8);

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
    };
    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };

    return createPortal(
        <div
            data-canvas-resource-mention-menu="true"
            className="fixed z-[120] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md"
            style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onClick={(event) => event.stopPropagation()}
        >
            {references.map((reference, index) => (
                <button
                    key={reference.id}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                >
                    <ReferencePreview reference={reference} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{reference.label}</span>
                        <span className="block truncate opacity-65">{reference.text || reference.title}</span>
                    </span>
                </button>
            ))}
        </div>,
        document.body,
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
