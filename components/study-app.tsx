"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, Ban, Bold, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock3, Copy, Eraser, FileText, Heading1, Heading2, Highlighter, Home, ImagePlus, Italic, Layers3, List, ListOrdered, Lock, LogOut, Move, NotebookPen, Pilcrow, Plus, RotateCw, Search, Shield, Sparkles, Trash2, Underline, Unlock, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { allTopics, curriculum, type Priority, type Subject, type Topic } from "@/lib/curriculum";
import type { SessionUser } from "@/components/auth-gate";
import { ErrorNotebook, type ErrorNote } from "@/components/error-notebook";

type TopicState = { topicId: string; summaryHtml: string; reviewText: string; completed: boolean; totalSeconds: number; updatedAt: string };
type Summary = { id: string; topicId: string; title: string; contentHtml: string; reviewText: string; createdAt: string; updatedAt: string };
type Activity = { id: number; type: string; topicId: string; topicName: string; subjectName: string; createdAt: string };
type Flashcard = { id: number; topicId: string; sourceSummaryId: string | null; sourceErrorId: string | null; topicName: string; subjectName: string; priority: Priority; sourceReview: string; question: string; answer: string; dueAt: string; intervalDays: number; lastReviewedAt: string | null; createdAt: string };
type GeneratedReview = { reviewText: string; keyPoints: string[]; generationId: string; model: string };
type ScheduleDay = "segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado" | "domingo";
type ScheduleBlock = { id: string; day: ScheduleDay; subjectId: string; startMinutes: number; durationMinutes: number; position: number; createdAt: string; updatedAt: string };
type ScheduleSettings = { availableDays: ScheduleDay[]; minutesPerDay: number; includedSubjectIds: string[]; updatedAt: string };
type AppData = { topics: TopicState[]; summaries: Summary[]; activities: Activity[]; flashcards: Flashcard[]; errorNotes: ErrorNote[]; scheduleBlocks: ScheduleBlock[]; scheduleSettings: ScheduleSettings | null };
type View = "dashboard" | "subjects" | "subject" | "topic" | "errors" | "flashcards" | "schedule" | "admin";
type TopicFilter = "TODOS" | Priority | "COM RESUMO" | "SEM RESUMO";
type ImageAlignment = "left" | "center" | "right";
type SelectedImage = { id: string; width: number; height: number; lockAspect: boolean; alignment: ImageAlignment };

const scheduleDays: Array<{ id: ScheduleDay; label: string; short: string }> = [
  { id: "segunda", label: "Segunda-feira", short: "SEG" },
  { id: "terca", label: "Terça-feira", short: "TER" },
  { id: "quarta", label: "Quarta-feira", short: "QUA" },
  { id: "quinta", label: "Quinta-feira", short: "QUI" },
  { id: "sexta", label: "Sexta-feira", short: "SEX" },
  { id: "sabado", label: "Sábado", short: "SÁB" },
  { id: "domingo", label: "Domingo", short: "DOM" },
];
const defaultScheduleSettings: ScheduleSettings = { availableDays: ["segunda", "terca", "quarta", "quinta", "sexta"], minutesPerDay: 180, includedSubjectIds: curriculum.map((subject) => subject.id), updatedAt: "" };
const emptyData: AppData = { topics: [], summaries: [], activities: [], flashcards: [], errorNotes: [], scheduleBlocks: [], scheduleSettings: null };
const pad = (n: number) => String(n).padStart(2, "0");
const isToday = (iso: string | null) => iso ? new Date(iso).toDateString() === new Date().toDateString() : false;

function minutesToTime(value: number) {
  const minutes = Math.max(0, Math.min(1439, Math.round(value)));
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return Math.max(0, Math.min(1439, (hours || 0) * 60 + (minutes || 0)));
}

function formatDuration(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes}min`;
  return minutes ? `${hours}h${pad(minutes)}` : `${hours}h`;
}

function priorityClass(priority: Priority) {
  return priority === "ALTA" ? "priority high" : priority === "MÉDIA" ? "priority medium" : "priority low";
}

function stripHtml(value: string) {
  if (typeof window === "undefined") return value.replace(/<[^>]*>/g, " ");
  const node = document.createElement("div"); node.innerHTML = value; return node.textContent || "";
}

function summaryUpdatedLabel(iso: string) {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) return "Atualizado hoje";
  return `Atualizado em ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date)}`;
}

export function StudyApp({ currentUser, onUserUpdated, onLogout, onSessionExpired }: { currentUser: SessionUser; onUserUpdated: (user: SessionUser) => void; onLogout: () => void; onSessionExpired: () => void }) {
  const [view, setView] = useState<View>("dashboard");
  const [data, setData] = useState<AppData>(emptyData);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [filter, setFilter] = useState<TopicFilter>("TODOS");
  const [activeSummaryId, setActiveSummaryId] = useState<string | null>(null);
  const [summaryTitle, setSummaryTitle] = useState("Resumo 1");
  const [savingSummary, setSavingSummary] = useState(false);
  const [summaryEditorOpen, setSummaryEditorOpen] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [reviewDraft, setReviewDraft] = useState("");
  const [status, setStatus] = useState("Carregando seu caderno…");
  const [flashSubject, setFlashSubject] = useState("TODAS");
  const [flashTopic, setFlashTopic] = useState("TODOS");
  const [flashPriority, setFlashPriority] = useState<"TODAS" | Priority>("TODAS");
  const [dueOnly, setDueOnly] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [generatingReview, setGeneratingReview] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [generatedBundle, setGeneratedBundle] = useState<GeneratedReview | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const editorSectionRef = useRef<HTMLElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef("");
  const activeSummaryIdRef = useRef<string | null>(null);
  const summaryTitleRef = useRef("Resumo 1");
  const summaryDirtyRef = useRef(false);
  const savingSummaryRef = useRef(false);
  const summarySavePromiseRef = useRef<Promise<void> | null>(null);
  const selectedTopicIdRef = useRef<string | null>(null);
  const generatingReviewRef = useRef(false);
  const savingReviewRef = useRef(false);
  const draggedImageRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<{ wrapper: HTMLElement; handle: string; startX: number; startY: number; width: number; height: number; ratio: number; lockAspect: boolean } | null>(null);
  const stateMap = useMemo(() => new Map(data.topics.map((item) => [item.topicId, item])), [data.topics]);
  const topicState = selectedTopic ? stateMap.get(selectedTopic.id) : undefined;
  const topicSummaries = useMemo(() => selectedTopic ? data.summaries.filter((item) => item.topicId === selectedTopic.id) : [], [data.summaries, selectedTopic]);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/study", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) { onSessionExpired(); return; }
      if (!response.ok) throw new Error("storage");
      setData(await response.json()); setStatus("");
    } catch { setStatus("Seu caderno está sendo preparado. As alterações serão salvas assim que o armazenamento responder."); }
  }, [onSessionExpired]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    if (view !== "topic" || !selectedTopic) return;
    const timer = window.setTimeout(() => {
      const summaryCount = data.summaries.filter((item) => item.topicId === selectedTopic.id).length;
      const nextTitle = `Resumo ${summaryCount + 1}`;
      activeSummaryIdRef.current = null;
      summaryTitleRef.current = nextTitle;
      summaryRef.current = "";
      summaryDirtyRef.current = false;
      setActiveSummaryId(null);
      setSummaryTitle(nextTitle);
      setReviewDraft("");
      setGeneratedBundle(null);
      setSummaryEditorOpen(true);
      setSelectedImage(null);
      if (editorRef.current) editorRef.current.innerHTML = "";
    }, 0);
    return () => window.clearTimeout(timer);
    // Reset only when navigating to a different topic, not after each data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedTopic?.id]);
  useEffect(() => {
    if (view === "topic" && summaryEditorOpen && editorRef.current) editorRef.current.innerHTML = summaryRef.current;
  }, [view, summaryEditorOpen, activeSummaryId]);

  async function send(payload: Record<string, unknown>, reload = true) {
    const response = await fetch("/api/study", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(result.error || "Não foi possível concluir esta ação.");
    if (reload) await loadData();
    return result;
  }
  function openSubject(subject: Subject) { setSelectedSubject(subject); setFilter("TODOS"); setView("subject"); window.scrollTo(0, 0); }
  async function openTopic(subject: Subject, topic: Topic) {
    if (view === "topic" && summaryDirtyRef.current && selectedTopic?.id !== topic.id) {
      setStatus("Salve o resumo atual antes de abrir outro tópico.");
      return;
    }
    selectedTopicIdRef.current = topic.id;
    activeSummaryIdRef.current = null;
    generatingReviewRef.current = false;
    savingReviewRef.current = false;
    setSelectedSubject(subject);
    setSelectedTopic(topic);
    setActiveSummaryId(null);
    setGeneratedBundle(null);
    setGeneratingReview(false);
    setSavingReview(false);
    setView("topic");
    window.scrollTo(0, 0);
  }

  async function saveSummary() {
    if (!selectedTopic || !selectedSubject) return;
    if (summarySavePromiseRef.current) {
      await summarySavePromiseRef.current;
      return;
    }
    if (!stripHtml(summaryRef.current).trim()) {
      setStatus("Escreva o resumo antes de salvar.");
      return;
    }
    const topic = selectedTopic;
    const subject = selectedSubject;
    const existingSummary = topicSummaries.find((summary) => summary.id === activeSummaryIdRef.current);
    const summaryMode = existingSummary ? "update" : "create";
    const summaryId = existingSummary?.id || activeSummaryIdRef.current || crypto.randomUUID();
    activeSummaryIdRef.current = summaryId;
    setActiveSummaryId(summaryId);
    const operation = (async () => {
      savingSummaryRef.current = true;
      setSavingSummary(true);
      try {
        const currentSummary = summaryRef.current;
        const currentTitle = summaryTitleRef.current.trim() || "Resumo";
        const result = await send({ action: "summary", summaryMode, summaryId, summaryTitle: currentTitle, topicId: topic.id, topicName: topic.name, subjectName: subject.name, summaryHtml: currentSummary, recordActivity: true }, false) as { summary?: Summary };
        if (!result.summary) throw new Error("O servidor não confirmou o resumo salvo.");
        await loadData();
        resetSummaryDraft(`Resumo ${topicSummaries.length + (summaryMode === "create" ? 2 : 1)}`, true);
        setStatus(summaryMode === "update" ? "Alterações salvas. O editor está pronto para um novo resumo." : "Novo resumo salvo. O editor foi limpo para você criar outro.");
      } catch (error) {
        setStatus(error instanceof Error ? `${error.message} O conteúdo continua aberto no editor.` : "O conteúdo continua aberto no editor. Não foi possível salvar agora.");
      }
      finally { savingSummaryRef.current = false; setSavingSummary(false); }
    })();
    summarySavePromiseRef.current = operation;
    try { await operation; }
    finally { if (summarySavePromiseRef.current === operation) summarySavePromiseRef.current = null; }
  }
  function resetSummaryDraft(nextTitle: string, focusEditor = false) {
    activeSummaryIdRef.current = null;
    summaryTitleRef.current = nextTitle;
    summaryRef.current = "";
    summaryDirtyRef.current = false;
    setActiveSummaryId(null);
    setSummaryTitle(nextTitle);
    setReviewDraft("");
    setGeneratedBundle(null);
    setSummaryEditorOpen(true);
    setSelectedImage(null);
    if (editorRef.current) {
      editorRef.current.innerHTML = "";
      if (focusEditor) editorRef.current.focus();
    }
  }
  function currentEditorHtml() {
    if (!editorRef.current) return summaryRef.current;
    const clone = editorRef.current.cloneNode(true) as HTMLDivElement;
    clone.querySelectorAll(".is-selected").forEach((element) => element.classList.remove("is-selected"));
    return clone.innerHTML;
  }
  function onEditorInput() {
    summaryRef.current = currentEditorHtml();
    if (!summaryDirtyRef.current) setStatus("Alterações não salvas. Clique em Salvar resumo.");
    summaryDirtyRef.current = true;
  }
  function selectedImageElement() {
    if (!selectedImage || !editorRef.current) return null;
    return [...editorRef.current.querySelectorAll<HTMLElement>("[data-summary-image]")].find((element) => element.dataset.summaryImage === selectedImage.id) || null;
  }
  function readImageState(wrapper: HTMLElement): SelectedImage {
    const rect = wrapper.getBoundingClientRect();
    return {
      id: wrapper.dataset.summaryImage || "",
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      lockAspect: wrapper.dataset.lockAspect !== "false",
      alignment: (wrapper.dataset.alignment as ImageAlignment) || "center",
    };
  }
  function selectEditorImage(wrapper: HTMLElement | null) {
    editorRef.current?.querySelectorAll("[data-summary-image]").forEach((element) => element.classList.toggle("is-selected", element === wrapper));
    setSelectedImage(wrapper ? readImageState(wrapper) : null);
  }
  function onEditorClick(event: React.MouseEvent<HTMLDivElement>) {
    const wrapper = (event.target as HTMLElement).closest<HTMLElement>("[data-summary-image]");
    selectEditorImage(wrapper);
  }
  function changeImageSize(axis: "width" | "height", rawValue: number) {
    const wrapper = selectedImageElement();
    if (!wrapper || !selectedImage || !Number.isFinite(rawValue)) return;
    const maximumWidth = Math.max(120, (editorRef.current?.clientWidth || 760) - 32);
    let width = axis === "width" ? Math.min(maximumWidth, Math.max(80, rawValue)) : selectedImage.width;
    let height = axis === "height" ? Math.min(1600, Math.max(60, rawValue)) : selectedImage.height;
    const ratio = Number(wrapper.dataset.aspectRatio) || selectedImage.width / selectedImage.height || 1;
    if (selectedImage.lockAspect) {
      if (axis === "width") height = width / ratio;
      else width = Math.min(maximumWidth, height * ratio);
    }
    wrapper.style.width = `${Math.round(width)}px`;
    wrapper.style.height = `${Math.round(height)}px`;
    setSelectedImage(readImageState(wrapper));
    onEditorInput();
  }
  function toggleImageAspect() {
    const wrapper = selectedImageElement();
    if (!wrapper) return;
    wrapper.dataset.lockAspect = wrapper.dataset.lockAspect === "false" ? "true" : "false";
    setSelectedImage(readImageState(wrapper));
    onEditorInput();
  }
  function alignImage(alignment: ImageAlignment) {
    const wrapper = selectedImageElement();
    if (!wrapper) return;
    wrapper.dataset.alignment = alignment;
    wrapper.style.marginLeft = alignment === "left" ? "0" : "auto";
    wrapper.style.marginRight = alignment === "right" ? "0" : "auto";
    setSelectedImage(readImageState(wrapper));
    onEditorInput();
  }
  function removeSelectedImage() {
    const wrapper = selectedImageElement();
    if (!wrapper) return;
    const imageId = wrapper.dataset.summaryImage;
    wrapper.remove();
    setSelectedImage(null);
    onEditorInput();
    if (imageId) void fetch(`/api/summary-images?id=${encodeURIComponent(imageId)}`, { method: "DELETE" });
  }
  function onImageResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-resize-handle]");
    const wrapper = handle?.closest<HTMLElement>("[data-summary-image]");
    if (!handle || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    resizeRef.current = {
      wrapper,
      handle: handle.dataset.resizeHandle || "se",
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      ratio: Number(wrapper.dataset.aspectRatio) || rect.width / rect.height || 1,
      lockAspect: wrapper.dataset.lockAspect !== "false",
    };
    handle.setPointerCapture(event.pointerId);
    selectEditorImage(wrapper);
    event.preventDefault();
  }
  function onImageResizeMove(event: React.PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    const dx = (resize.handle.includes("e") ? 1 : -1) * (event.clientX - resize.startX);
    const dy = (resize.handle.includes("s") ? 1 : -1) * (event.clientY - resize.startY);
    const maximumWidth = Math.max(120, (editorRef.current?.clientWidth || 760) - 32);
    let width = Math.min(maximumWidth, Math.max(80, resize.width + dx));
    let height = Math.min(1600, Math.max(60, resize.height + dy));
    if (resize.lockAspect) {
      if (Math.abs(dx) >= Math.abs(dy)) height = width / resize.ratio;
      else width = Math.min(maximumWidth, height * resize.ratio);
    }
    resize.wrapper.style.width = `${Math.round(width)}px`;
    resize.wrapper.style.height = `${Math.round(height)}px`;
    setSelectedImage(readImageState(resize.wrapper));
  }
  function onImageResizeEnd() {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    onEditorInput();
  }
  function onImageDragStart(event: React.DragEvent<HTMLDivElement>) {
    const wrapper = (event.target as HTMLElement).closest<HTMLElement>("[data-summary-image]");
    if (!wrapper) return;
    draggedImageRef.current = wrapper;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", wrapper.dataset.summaryImage || "image");
    selectEditorImage(wrapper);
  }
  function onImageDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!draggedImageRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
  function onImageDrop(event: React.DragEvent<HTMLDivElement>) {
    const wrapper = draggedImageRef.current;
    if (!wrapper || !editorRef.current) return;
    event.preventDefault();
    const target = (event.target as HTMLElement).closest<HTMLElement>("p,h1,h2,li,[data-summary-image]");
    if (target && target !== wrapper && !wrapper.contains(target)) {
      const rect = target.getBoundingClientRect();
      target.parentNode?.insertBefore(wrapper, event.clientY > rect.top + rect.height / 2 ? target.nextSibling : target);
    } else if (!target) editorRef.current.appendChild(wrapper);
    draggedImageRef.current = null;
    selectEditorImage(wrapper);
    onEditorInput();
  }
  async function uploadSummaryImage(file: File) {
    if (!selectedTopic || !selectedSubject || uploadingImage) return;
    if (!file.type.startsWith("image/")) { setStatus("Escolha um arquivo de imagem."); return; }
    if (file.size > 8 * 1024 * 1024) { setStatus("A imagem deve ter no máximo 8 MB."); return; }
    const summaryId = activeSummaryIdRef.current || crypto.randomUUID();
    activeSummaryIdRef.current = summaryId;
    setActiveSummaryId(summaryId);
    setSummaryEditorOpen(true);
    setUploadingImage(true);
    setStatus("Enviando a imagem…");
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const preview = new Image();
        const url = URL.createObjectURL(file);
        preview.onload = () => { resolve({ width: preview.naturalWidth, height: preview.naturalHeight }); URL.revokeObjectURL(url); };
        preview.onerror = () => { reject(new Error("Imagem inválida")); URL.revokeObjectURL(url); };
        preview.src = url;
      });
      const form = new FormData();
      form.append("image", file);
      form.append("topicId", selectedTopic.id);
      form.append("summaryId", summaryId);
      const response = await fetch("/api/summary-images", { method: "POST", body: form });
      const result = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: string };
      if (!response.ok || !result.id || !result.url) throw new Error(result.error || "Não foi possível enviar a imagem.");
      const editor = editorRef.current;
      if (!editor) throw new Error("O editor não está disponível.");
      const width = Math.min(Math.max(180, dimensions.width), Math.max(180, editor.clientWidth - 32), 640);
      const height = Math.max(100, width / Math.max(.1, dimensions.width / dimensions.height));
      const wrapper = document.createElement("span");
      wrapper.className = "summary-image";
      wrapper.dataset.summaryImage = result.id;
      wrapper.dataset.aspectRatio = String(dimensions.width / dimensions.height);
      wrapper.dataset.lockAspect = "true";
      wrapper.dataset.alignment = "center";
      wrapper.contentEditable = "false";
      wrapper.draggable = true;
      wrapper.style.width = `${Math.round(width)}px`;
      wrapper.style.height = `${Math.round(height)}px`;
      wrapper.style.marginLeft = "auto";
      wrapper.style.marginRight = "auto";
      const image = document.createElement("img");
      image.src = result.url;
      image.alt = file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Imagem do resumo";
      image.draggable = false;
      wrapper.appendChild(image);
      (["nw", "ne", "sw", "se"] as const).forEach((corner) => {
        const handle = document.createElement("span");
        handle.className = `image-resize-handle ${corner}`;
        handle.dataset.resizeHandle = corner;
        wrapper.appendChild(handle);
      });
      editor.appendChild(wrapper);
      const paragraph = document.createElement("p");
      paragraph.appendChild(document.createElement("br"));
      editor.appendChild(paragraph);
      selectEditorImage(wrapper);
      onEditorInput();
      setStatus("Imagem adicionada. Clique em Salvar resumo para gravar as alterações.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível enviar a imagem agora.");
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }
  function onSummaryTitleChange(value: string) {
    setSummaryTitle(value);
    summaryTitleRef.current = value;
    if (!summaryDirtyRef.current) setStatus("Alterações não salvas. Clique em Salvar resumo.");
    summaryDirtyRef.current = true;
  }
  async function selectSummary(summary: Summary) {
    if (savingSummaryRef.current) return;
    if (summaryDirtyRef.current && activeSummaryIdRef.current !== summary.id) {
      setStatus("Salve o resumo atual antes de abrir outro.");
      return;
    }
    activeSummaryIdRef.current = summary.id;
    summaryTitleRef.current = summary.title;
    summaryRef.current = summary.contentHtml;
    summaryDirtyRef.current = false;
    setActiveSummaryId(summary.id);
    setSummaryTitle(summary.title);
    setReviewDraft(summary.reviewText || "");
    setGeneratedBundle(null);
    setSummaryEditorOpen(true);
    setSelectedImage(null);
    if (editorRef.current) editorRef.current.innerHTML = summaryRef.current;
    requestAnimationFrame(() => editorSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  async function newSummary() {
    if (!selectedTopic || savingSummaryRef.current) return;
    if (summaryDirtyRef.current) {
      setStatus("Salve o resumo atual antes de criar outro.");
      return;
    }
    resetSummaryDraft(`Resumo ${topicSummaries.length + 1}`, true);
    setStatus("Novo resumo aberto. Escreva o conteúdo e clique em Salvar resumo.");
    requestAnimationFrame(() => editorSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  async function deleteSummary(summaryId: string) {
    if (!selectedTopic || !selectedSubject || savingSummaryRef.current) return;
    const deletedWasActive = activeSummaryIdRef.current === summaryId;
    savingSummaryRef.current = true;
    setSavingSummary(true);
    try {
      const response = await fetch("/api/study", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaryId, topicId: selectedTopic.id, topicName: selectedTopic.name, subjectName: selectedSubject.name }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível excluir o resumo.");
      await loadData();
      if (deletedWasActive || (!activeSummaryIdRef.current && !summaryDirtyRef.current)) resetSummaryDraft(`Resumo ${Math.max(1, topicSummaries.length)}`);
      setStatus("Resumo excluído.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível excluir o resumo agora.");
    } finally { savingSummaryRef.current = false; setSavingSummary(false); }
  }
  async function saveReview() {
    if (!selectedTopic || !selectedSubject || savingReviewRef.current || reviewDraft.trim().length < 20) return;
    const summaryId = activeSummaryIdRef.current;
    if (!summaryId || !topicSummaries.some((summary) => summary.id === summaryId)) {
      setStatus("Salve o resumo antes de salvar a revisão aprimorada.");
      return;
    }
    savingReviewRef.current = true;
    setSavingReview(true);
    setStatus("Salvando a revisão aprimorada…");
    try {
      await send({ action: "review", summaryId, topicId: selectedTopic.id, topicName: selectedTopic.name, subjectName: selectedSubject.name, reviewText: reviewDraft, generationId: generatedBundle?.generationId });
      setGeneratedBundle(null);
      setStatus("Revisão salva. Abrir novamente não gera nova cobrança de IA.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível salvar a revisão agora."); }
    finally { savingReviewRef.current = false; setSavingReview(false); }
  }
  async function generateReviewWithAi() {
    if (!selectedTopic || !selectedSubject || generatingReviewRef.current) return;
    const summaryId = activeSummaryIdRef.current;
    if (!summaryId || !topicSummaries.some((summary) => summary.id === summaryId)) {
      setStatus("Salve o resumo antes de gerar a revisão com o ChatGPT.");
      return;
    }
    if (stripHtml(summaryRef.current).replace(/\s+/g, " ").trim().length < 20) {
      setStatus("Escreva um pouco mais no resumo antes de gerar a revisão.");
      return;
    }
    const topicId = selectedTopic.id;
    generatingReviewRef.current = true;
    setGeneratingReview(true);
    setGeneratedBundle(null);
    setStatus("O ChatGPT está descomplicando seu resumo…");
    try {
      const response = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enhanceReview", topicName: selectedTopic.name, subjectName: selectedSubject.name, summaryHtml: summaryRef.current }),
      });
      const result = await response.json().catch(() => ({})) as Partial<GeneratedReview> & { error?: string };
      if (!response.ok || !result.reviewText || !result.generationId || !result.model) throw new Error(result.error || "A IA não conseguiu aprimorar a revisão.");
      if (selectedTopicIdRef.current === topicId) {
        const bundle = result as GeneratedReview;
        setReviewDraft(bundle.reviewText);
        setGeneratedBundle(bundle);
      }
      setStatus("Revisão aprimorada. Confira e salve o resultado.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível conectar ao ChatGPT agora.");
    } finally {
      generatingReviewRef.current = false;
      setGeneratingReview(false);
    }
  }
  async function toggleCompleted(completed: boolean) {
    if (!selectedTopic || !selectedSubject) return;
    try { await send({ action: "completed", topicId: selectedTopic.id, topicName: selectedTopic.name, subjectName: selectedSubject.name, completed }); setStatus(completed ? "Tópico concluído." : "Tópico reaberto."); }
    catch { setStatus("Não foi possível atualizar o tópico agora."); }
  }
  function showFlashcards(onlyDue = true) { setDueOnly(onlyDue); setRevealed(false); setView("flashcards"); window.scrollTo(0, 0); }
  async function reviewCard(card: Flashcard, remembered: boolean) {
    try { await send({ action: "flashcard", id: card.id, remembered }, false); await loadData(); setRevealed(false); setStatus(remembered ? "Certo. Este cartão volta mais tarde." : "Tudo bem. Ele reaparece em breve."); }
    catch { setStatus("Não foi possível registrar esta revisão agora."); }
  }

  async function saveSchedule(nextBlocks: ScheduleBlock[], nextSettings = data.scheduleSettings || defaultScheduleSettings) {
    if (savingSchedule) return false;
    const dayPositions = new Map<ScheduleDay, number>();
    const normalized = nextBlocks.map((block) => {
      const position = dayPositions.get(block.day) || 0;
      dayPositions.set(block.day, position + 1);
      return { ...block, position };
    });
    const previousBlocks = data.scheduleBlocks;
    const previousSettings = data.scheduleSettings;
    setData((current) => ({ ...current, scheduleBlocks: normalized, scheduleSettings: nextSettings }));
    setSavingSchedule(true);
    setStatus("Salvando o cronograma…");
    try {
      const result = await send({
        action: "scheduleSave",
        blocks: normalized,
        availableDays: nextSettings.availableDays,
        minutesPerDay: nextSettings.minutesPerDay,
        includedSubjectIds: nextSettings.includedSubjectIds,
      }, false) as { scheduleBlocks?: ScheduleBlock[]; scheduleSettings?: ScheduleSettings };
      setData((current) => ({
        ...current,
        scheduleBlocks: result.scheduleBlocks || normalized,
        scheduleSettings: result.scheduleSettings || nextSettings,
      }));
      setStatus("Cronograma salvo.");
      return true;
    } catch {
      setData((current) => ({ ...current, scheduleBlocks: previousBlocks, scheduleSettings: previousSettings }));
      setStatus("Não foi possível salvar o cronograma agora. Tente novamente.");
      return false;
    } finally {
      setSavingSchedule(false);
    }
  }

  async function generateSchedule(days: ScheduleDay[], minutesPerDay: number, subjectIds: string[]) {
    if (!days.length || !subjectIds.length) return false;
    const blocks: ScheduleBlock[] = [];
    let subjectCursor = 0;
    days.forEach((day) => {
      const blocksPerDay = Math.min(subjectIds.length, Math.max(1, Math.round(minutesPerDay / 60)));
      const baseDuration = Math.max(30, Math.floor(minutesPerDay / blocksPerDay / 30) * 30);
      let remaining = Math.max(0, minutesPerDay - baseDuration * blocksPerDay);
      let startMinutes = minutesPerDay >= 360 ? 8 * 60 : 18 * 60;
      for (let position = 0; position < blocksPerDay; position += 1) {
        const extra = Math.min(30, remaining);
        const durationMinutes = baseDuration + extra;
        remaining -= extra;
        blocks.push({
          id: crypto.randomUUID(),
          day,
          subjectId: subjectIds[subjectCursor % subjectIds.length],
          startMinutes,
          durationMinutes,
          position,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        subjectCursor += 1;
        startMinutes += durationMinutes;
      }
    });
    return saveSchedule(blocks, { availableDays: days, minutesPerDay, includedSubjectIds: subjectIds, updatedAt: "" });
  }

  function updateScheduleBlock(id: string, patch: Partial<Pick<ScheduleBlock, "day" | "subjectId" | "startMinutes" | "durationMinutes">>) {
    const next = data.scheduleBlocks.map((block) => block.id === id ? { ...block, ...patch } : block);
    void saveSchedule(next);
  }

  function addScheduleBlock(day: ScheduleDay) {
    const dayBlocks = data.scheduleBlocks.filter((block) => block.day === day).sort((a, b) => a.position - b.position);
    const last = dayBlocks.at(-1);
    const startMinutes = Math.min(last ? last.startMinutes + last.durationMinutes : 18 * 60, 23 * 60);
    const subjectId = data.scheduleSettings?.includedSubjectIds[0] || curriculum[0].id;
    const next = [...data.scheduleBlocks, {
      id: crypto.randomUUID(),
      day,
      subjectId,
      startMinutes,
      durationMinutes: 60,
      position: dayBlocks.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    void saveSchedule(next);
  }

  function deleteScheduleBlock(id: string) {
    void saveSchedule(data.scheduleBlocks.filter((block) => block.id !== id));
  }

  function moveScheduleBlock(id: string, direction: -1 | 1) {
    const current = data.scheduleBlocks.find((block) => block.id === id);
    if (!current) return;
    const dayBlocks = data.scheduleBlocks.filter((block) => block.day === current.day).sort((a, b) => a.position - b.position);
    const index = dayBlocks.findIndex((block) => block.id === id);
    const target = index + direction;
    if (target < 0 || target >= dayBlocks.length) return;
    [dayBlocks[index], dayBlocks[target]] = [dayBlocks[target], dayBlocks[index]];
    const order = new Map(dayBlocks.map((block, position) => [block.id, position]));
    const next = data.scheduleBlocks.map((block) => block.day === current.day ? { ...block, position: order.get(block.id) || 0 } : block)
      .sort((a, b) => scheduleDays.findIndex((day) => day.id === a.day) - scheduleDays.findIndex((day) => day.id === b.day) || a.position - b.position);
    void saveSchedule(next);
  }

  const totalTopics = allTopics.length;
  const studiedTopicIds = new Set(data.summaries.filter((summary) => stripHtml(summary.contentHtml).trim()).map((summary) => summary.topicId));
  data.topics.forEach((topic) => { if (stripHtml(topic.summaryHtml).trim()) studiedTopicIds.add(topic.topicId); });
  const studied = studiedTopicIds.size;
  const completed = data.topics.filter((item) => item.completed).length;
  const summaryCount = data.summaries.length;
  const reviews = data.summaries.filter((item) => item.reviewText?.trim()).length;
  const dueCards = data.flashcards.filter((card) => new Date(card.dueAt) <= new Date());
  const reviewedToday = data.flashcards.filter((card) => isToday(card.lastReviewedAt)).length;
  const progress = Math.round((studied / totalTopics) * 100);
  const filteredCards = data.flashcards.filter((card) => (!dueOnly || new Date(card.dueAt) <= new Date()) && (flashSubject === "TODAS" || card.subjectName === flashSubject) && (flashTopic === "TODOS" || card.topicId === flashTopic) && (flashPriority === "TODAS" || card.priority === flashPriority));
  const currentCard = filteredCards[0];

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool?: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({ name: "open_due_flashcards", title: "Abrir flashcards pendentes", description: "Abre os flashcards que já estão no momento de revisar.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => { setDueOnly(true); setRevealed(false); setView("flashcards"); return { opened: true }; } }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* Navegadores sem WebMCP continuam funcionando normalmente. */ }
    return () => lifecycle.abort();
  }, []);

  return <div className="app-shell">
    <aside className="desktop-sidebar"><button className="brand" onClick={() => setView("dashboard")} aria-label="Voltar ao início"><img src="/pmba-logo-transparent.png" alt="Polícia Militar da Bahia" /></button><nav><NavButton active={view === "dashboard"} icon={<Home />} label="Início" onClick={() => setView("dashboard")} /><NavButton active={["subjects", "subject", "topic"].includes(view)} icon={<BookOpen />} label="Matérias" onClick={() => setView("subjects")} /><NavButton active={view === "errors"} icon={<NotebookPen />} label="Caderno de erros" badge={data.errorNotes.length} onClick={() => setView("errors")} /><NavButton active={view === "schedule"} icon={<CalendarDays />} label="Cronograma" onClick={() => setView("schedule")} /><NavButton active={view === "flashcards"} icon={<Layers3 />} label="Flashcards" badge={dueCards.length} onClick={() => showFlashcards(true)} />{currentUser.role === "admin" && <NavButton active={view === "admin"} icon={<Shield />} label="Administração" onClick={() => setView("admin")} />}</nav><div className="sidebar-account"><strong>{currentUser.name}</strong><span>{currentUser.role === "admin" ? "Administrador" : "Usuário"}</span><button type="button" onClick={onLogout}><LogOut /> Sair</button></div></aside>
    <main className="main-content"><div className="account-strip"><div className="account-identity"><img src="/pmba-logo-transparent.png" alt="Polícia Militar da Bahia" /><strong>{currentUser.name}</strong></div><button type="button" onClick={onLogout}><LogOut /> Sair</button></div>{status && <div className="status-line" role="status">{status}</div>}
      {view === "dashboard" && <Dashboard progress={progress} studied={studied} completed={completed} totalTopics={totalTopics} summaries={summaryCount} reviews={reviews} dueCards={dueCards.length} flashcards={data.flashcards.length} reviewedToday={reviewedToday} activities={data.activities} studiedTopicIds={studiedTopicIds} onSubject={openSubject} onFlashcards={() => showFlashcards(true)} />}
      {view === "subjects" && <Subjects studiedTopicIds={studiedTopicIds} onOpen={openSubject} />}
      {view === "subject" && selectedSubject && <SubjectView subject={selectedSubject} stateMap={stateMap} summaries={data.summaries} filter={filter} setFilter={setFilter} onBack={() => setView("subjects")} onTopic={(topic) => openTopic(selectedSubject, topic)} />}
      {view === "topic" && selectedSubject && selectedTopic && <TopicView subject={selectedSubject} topic={selectedTopic} state={topicState} summaries={topicSummaries} activeSummaryId={activeSummaryId} summaryTitle={summaryTitle} savingSummary={savingSummary} editorOpen={summaryEditorOpen} setEditorOpen={setSummaryEditorOpen} uploadingImage={uploadingImage} selectedImage={selectedImage} editorRef={editorRef} editorSectionRef={editorSectionRef} imageInputRef={imageInputRef} reviewDraft={reviewDraft} setReviewDraft={(value) => { setReviewDraft(value); setGeneratedBundle(null); }} generatedReview={Boolean(generatedBundle)} generatingReview={generatingReview} savingReview={savingReview} onBack={() => { selectedTopicIdRef.current = null; summaryDirtyRef.current = false; setView("subject"); }} onSelectSummary={(summary) => void selectSummary(summary)} onNewSummary={() => void newSummary()} onDeleteSummary={(summaryId) => void deleteSummary(summaryId)} onSummaryTitleChange={onSummaryTitleChange} onEditorInput={onEditorInput} onEditorClick={onEditorClick} onImageResizeStart={onImageResizeStart} onImageResizeMove={onImageResizeMove} onImageResizeEnd={onImageResizeEnd} onImageDragStart={onImageDragStart} onImageDragOver={onImageDragOver} onImageDrop={onImageDrop} onUploadImage={(file) => void uploadSummaryImage(file)} onChangeImageSize={changeImageSize} onToggleImageAspect={toggleImageAspect} onAlignImage={alignImage} onRemoveImage={removeSelectedImage} onFormat={(command, value) => { editorRef.current?.focus(); document.execCommand(command, false, value); onEditorInput(); }} onSave={() => void saveSummary()} onGenerate={() => void generateReviewWithAi()} onSaveReview={() => void saveReview()} onToggle={toggleCompleted} />}
      {view === "errors" && <ErrorNotebook notes={data.errorNotes} cards={data.flashcards} onChanged={loadData} onStatus={setStatus} />}
      {view === "schedule" && <ScheduleView blocks={data.scheduleBlocks} settings={data.scheduleSettings || defaultScheduleSettings} saving={savingSchedule} onGenerate={generateSchedule} onUpdate={updateScheduleBlock} onAdd={addScheduleBlock} onDelete={deleteScheduleBlock} onMove={moveScheduleBlock} />}
      {view === "flashcards" && <FlashcardsView cards={data.flashcards} filtered={filteredCards} current={currentCard} revealed={revealed} setRevealed={setRevealed} dueOnly={dueOnly} setDueOnly={setDueOnly} subject={flashSubject} setSubject={(value) => { setFlashSubject(value); setFlashTopic("TODOS"); setRevealed(false); }} topic={flashTopic} setTopic={(value) => { setFlashTopic(value); setRevealed(false); }} priority={flashPriority} setPriority={(value) => { setFlashPriority(value); setRevealed(false); }} onReview={reviewCard} />}
      {view === "admin" && currentUser.role === "admin" && <AdminPanel currentUser={currentUser} onUserUpdated={onUserUpdated} />}
    </main>
    <nav className="mobile-nav" aria-label="Navegação principal"><NavButton active={view === "dashboard"} icon={<Home />} label="Início" onClick={() => setView("dashboard")} /><NavButton active={["subjects", "subject", "topic"].includes(view)} icon={<BookOpen />} label="Matérias" onClick={() => setView("subjects")} /><NavButton active={view === "errors"} icon={<NotebookPen />} label="Erros" badge={data.errorNotes.length} onClick={() => setView("errors")} /><NavButton active={view === "schedule"} icon={<CalendarDays />} label="Agenda" onClick={() => setView("schedule")} /><NavButton active={view === "flashcards"} icon={<Layers3 />} label="Cards" badge={dueCards.length} onClick={() => showFlashcards(true)} />{currentUser.role === "admin" && <NavButton active={view === "admin"} icon={<Shield />} label="Admin" onClick={() => setView("admin")} />}</nav>
  </div>;
}

type AdminStats = { progress: number; studiedTopics: number; completedTopics: number; summaries: number; reviews: number; flashcards: number; reviewedFlashcards: number; totalSeconds: number };
type AdminUser = { id: string; name: string; email: string; role: "admin" | "user"; status: "PENDING" | "ACTIVE" | "BLOCKED"; emailVerifiedAt: string | null; mustChangePassword: boolean; createdAt: string; lastAccessAt: string | null; stats: AdminStats };
type AdminDetail = AdminUser & { subjectProgress: Array<{ id: string; name: string; studied: number; total: number; seconds: number }>; recentActivities: Activity[]; scheduleBlocks: ScheduleBlock[]; dueFlashcards: number };

function adminDate(value: string | null) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function AdminPanel({ currentUser, onUserUpdated }: { currentUser: SessionUser; onUserUpdated: (user: SessionUser) => void }) {
  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<AdminDetail | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [confirmTemporaryPassword, setConfirmTemporaryPassword] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileName, setProfileName] = useState(currentUser.name);
  const [profileEmail, setProfileEmail] = useState(currentUser.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [profileError, setProfileError] = useState("");

  const loadUsers = useCallback(async (search = "", userId = "") => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (userId) params.set("userId", userId);
      const response = await fetch(`/api/admin/users?${params}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as { users?: AdminUser[]; selected?: AdminDetail; error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível carregar os usuários.");
      setUsersList(result.users || []);
      if (userId) setSelected(result.selected || null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível carregar os usuários."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function changeStatus(user: AdminUser, status: "ACTIVE" | "BLOCKED") {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, status }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível alterar o acesso.");
      setNotice(status === "BLOCKED" ? "Usuário bloqueado e sessões encerradas." : user.status === "PENDING" ? "Conta aprovada. O usuário já pode entrar." : "Acesso reativado.");
      await loadUsers(query, user.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível alterar o acesso."); }
    finally { setBusy(false); }
  }

  async function resetPassword(user: AdminUser) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resetPassword", userId: user.id, password: temporaryPassword, confirmPassword: confirmTemporaryPassword }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível criar a senha temporária.");
      setTemporaryPassword("");
      setConfirmTemporaryPassword("");
      setShowPasswordReset(false);
      setNotice("Senha temporária criada. Compartilhe-a com o usuário; ele deverá trocá-la ao entrar.");
      await loadUsers(query, user.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível criar a senha temporária."); }
    finally { setBusy(false); }
  }

  async function deleteUser(user: AdminUser) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível excluir a conta.");
      setSelected(null);
      setNotice("Conta e dados pessoais excluídos.");
      await loadUsers(query);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível excluir a conta."); }
    finally { setBusy(false); }
  }

  async function openOwnProfile() {
    setProfileName(currentUser.name);
    setProfileEmail(currentUser.email);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setNotice("");
    setProfileError("");
    setProfileDialogOpen(true);
    await loadUsers(query, currentUser.id);
  }

  async function saveOwnProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    setProfileError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateProfile", name: profileName, email: profileEmail, currentPassword, newPassword, confirmNewPassword }),
      });
      const result = await response.json().catch(() => ({})) as { user?: SessionUser; error?: string; message?: string };
      if (!response.ok || !result.user) throw new Error(result.error || "Não foi possível atualizar o perfil.");
      onUserUpdated(result.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setProfileDialogOpen(false);
      setNotice(result.message || "Perfil atualizado.");
      await loadUsers(query, result.user.id);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Não foi possível atualizar o perfil.");
    } finally { setBusy(false); }
  }

  const scheduleMinutes = selected?.scheduleBlocks.reduce((sum, block) => sum + block.durationMinutes, 0) || 0;
  return <div className="page admin-page">
    <header className="page-header compact admin-header">
      <div><p className="eyebrow">ÁREA RESTRITA</p><h1>Administração</h1><p>Acompanhe usuários e controle o acesso sem misturar os dados de estudo.</p></div>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void openOwnProfile()}><UserCheck /> Editar meu perfil</Button>
    </header>
    {notice && <div className="admin-notice" role="status">{notice}</div>}
    <div className="admin-layout">
      <section className="admin-users-panel">
        <div className="section-heading"><div><p className="kicker">USUÁRIOS</p><h2>Contas cadastradas</h2></div><span>{usersList.length}</span></div>
        <form className="admin-search" onSubmit={(event) => { event.preventDefault(); void loadUsers(query); }}>
          <Search />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou e-mail" />
          <button>Buscar</button>
        </form>
        <div className="admin-user-list">
          {loading && !usersList.length ? <div className="empty-state"><RotateCw className="spin" /><p>Carregando usuários…</p></div> : usersList.map((user) =>
            <button key={user.id} className={selected?.id === user.id ? "admin-user-card active" : "admin-user-card"} onClick={() => { setShowPasswordReset(false); void loadUsers(query, user.id); }}>
              <span className={user.status === "ACTIVE" ? "user-avatar" : user.status === "PENDING" ? "user-avatar pending" : "user-avatar blocked"}>{user.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{user.name}</strong><small>{user.email}</small><em>{user.stats.progress}% do edital • {formatDuration(Math.round(user.stats.totalSeconds / 60))}</em></div>
              <span className={`user-status ${user.status.toLowerCase()}`}>{user.status === "ACTIVE" ? "ATIVO" : user.status === "PENDING" ? "PENDENTE" : "BLOQUEADO"}</span>
            </button>
          )}
        </div>
      </section>
      <section className="admin-detail-panel">
        {selected ? <>
          <div className="admin-profile">
            <span className="user-avatar large">{selected.name.slice(0, 1).toUpperCase()}</span>
            <div><p className="kicker">PERFIL</p><h2>{selected.name}</h2><p>{selected.email}</p><small>Criado em {adminDate(selected.createdAt)} • Último acesso: {adminDate(selected.lastAccessAt)}</small></div>
            <span className="role-badge">{selected.role === "admin" ? "ADMIN" : "USUÁRIO"}</span>
          </div>
          <div className="admin-actions">
            {selected.id === currentUser.id && <Button variant="outline" disabled={busy} onClick={() => void openOwnProfile()}><UserCheck /> Editar meu perfil</Button>}
            {selected.id !== currentUser.id && <>
              {selected.status === "ACTIVE"
                ? <Button variant="outline" disabled={busy} onClick={() => void changeStatus(selected, "BLOCKED")}><Ban /> Bloquear acesso</Button>
                : <Button variant="outline" disabled={busy} onClick={() => void changeStatus(selected, "ACTIVE")}><UserCheck /> {selected.status === "PENDING" ? "Aprovar conta" : "Reativar acesso"}</Button>}
              {selected.status !== "PENDING" && <Button variant="outline" disabled={busy} onClick={() => setShowPasswordReset((value) => !value)}><Lock /> Criar senha temporária</Button>}
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="outline" className="danger-action" disabled={busy}><Trash2 /> Excluir conta</Button></AlertDialogTrigger>
                <AlertDialogContent size="sm">
                  <AlertDialogHeader><AlertDialogTitle>Excluir esta conta?</AlertDialogTitle><AlertDialogDescription>Todos os resumos, imagens, flashcards, cronograma e progresso de {selected.name} serão removidos definitivamente.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void deleteUser(selected)}>Excluir conta</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>}
          </div>
          {showPasswordReset && selected.id !== currentUser.id && <div className="admin-password-reset">
            <div><strong>Senha temporária</strong><small>Use pelo menos 8 caracteres, com letras e números. O usuário será obrigado a trocá-la ao entrar.</small></div>
            <label><span>Nova senha temporária</span><input type="password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} autoComplete="new-password" /></label>
            <label><span>Confirmar senha</span><input type="password" value={confirmTemporaryPassword} onChange={(event) => setConfirmTemporaryPassword(event.target.value)} autoComplete="new-password" /></label>
            <div><Button variant="outline" disabled={busy} onClick={() => setShowPasswordReset(false)}>Cancelar</Button><Button disabled={busy} onClick={() => void resetPassword(selected)}>Salvar senha temporária</Button></div>
          </div>}
          <div className="admin-stat-grid">
            <Stat icon={<BookOpen />} label="Progresso geral" value={`${selected.stats.progress}%`} sub={`${selected.stats.studiedTopics} tópicos estudados`} />
            <Stat icon={<FileText />} label="Resumos" value={String(selected.stats.summaries)} sub={`${selected.stats.reviews} revisões`} />
            <Stat icon={<Layers3 />} label="Flashcards" value={String(selected.stats.flashcards)} sub={`${selected.dueFlashcards} para revisar`} />
            <Stat icon={<Clock3 />} label="Horas estudadas" value={formatDuration(Math.round(selected.stats.totalSeconds / 60))} sub={`${formatDuration(scheduleMinutes)} planejadas/semana`} />
          </div>
          <div className="admin-detail-columns">
            <div><p className="kicker">MATÉRIAS</p><h3>Progresso individual</h3><div className="admin-subjects">{selected.subjectProgress.map((subject) => { const value = Math.round(subject.studied / subject.total * 100); return <div key={subject.id}><span><b>{subject.name}</b><small>{subject.studied}/{subject.total} • {formatDuration(Math.round(subject.seconds / 60))}</small></span><Progress value={value} /></div>; })}</div></div>
            <div><p className="kicker">ATIVIDADE</p><h3>Últimos passos</h3>{selected.recentActivities.length ? <div className="activity-list compact">{selected.recentActivities.map((activity) => <div key={activity.id}><span className="activity-dot" /><p><b>{activity.type}</b><span>{activity.topicName}</span><small>{activity.subjectName}</small></p></div>)}</div> : <div className="empty-state"><FileText /><p>Nenhuma atividade ainda.</p></div>}</div>
          </div>
        </> : <div className="admin-empty"><Users /><h2>Selecione um usuário</h2><p>Abra uma conta para acompanhar progresso, resumos, revisões, flashcards e cronograma.</p></div>}
      </section>
    </div>
    <Dialog open={profileDialogOpen} onOpenChange={(open) => { if (!busy) setProfileDialogOpen(open); }}>
      <DialogContent className="admin-profile-dialog">
        <DialogHeader><DialogTitle>Editar meu perfil</DialogTitle><DialogDescription>Atualize seus dados. Confirme a senha atual para salvar.</DialogDescription></DialogHeader>
        <form className="admin-profile-form" onSubmit={(event) => void saveOwnProfile(event)}>
          {profileError && <div className="profile-form-error" role="alert">{profileError}</div>}
          <label><span>Nome</span><input value={profileName} onChange={(event) => setProfileName(event.target.value)} minLength={2} maxLength={100} autoComplete="name" required disabled={busy} /></label>
          <label><span>E-mail</span><input value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} type="email" maxLength={254} autoComplete="email" required disabled={busy} /></label>
          <label><span>Senha atual</span><input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" maxLength={128} autoComplete="current-password" required disabled={busy} /></label>
          <div className="profile-password-fields">
            <label><span>Nova senha <small>(opcional)</small></span><input value={newPassword} onChange={(event) => { const value = event.target.value; setNewPassword(value); if (!value) setConfirmNewPassword(""); }} type="password" minLength={8} maxLength={128} autoComplete="new-password" disabled={busy} /></label>
            <label><span>Confirmar nova senha</span><input value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} type="password" minLength={8} maxLength={128} autoComplete="new-password" required={Boolean(newPassword)} disabled={busy || !newPassword} /></label>
          </div>
          <p>Deixe os campos de nova senha vazios se quiser alterar somente o nome ou o e-mail.</p>
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setProfileDialogOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? <><RotateCw className="spin" /> Salvando…</> : "Salvar perfil"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

function NavButton({ active, icon, label, badge, onClick }: { active: boolean; icon: React.ReactNode; label: string; badge?: number; onClick: () => void }) {
  return <button className={active ? "nav-button active" : "nav-button"} onClick={onClick}><span className="nav-icon">{icon}{badge ? <i>{badge}</i> : null}</span><span>{label}</span></button>;
}

function Dashboard(props: { progress: number; studied: number; completed: number; totalTopics: number; summaries: number; reviews: number; dueCards: number; flashcards: number; reviewedToday: number; activities: Activity[]; studiedTopicIds: Set<string>; onSubject: (subject: Subject) => void; onFlashcards: () => void }) {
  return <div className="page dashboard-page"><header className="page-header"><div><p className="eyebrow">SEU CADERNO DIGITAL</p><h1>Bom estudo.</h1><p>Um passo por vez, direto pelo edital.</p></div></header><section className="dashboard-grid"><div className="progress-card"><div className="progress-ring" style={{ "--progress": `${props.progress * 3.6}deg` } as React.CSSProperties}><div><strong>{props.progress}%</strong><span>PROGRESSO</span></div></div><div><p className="kicker">VISÃO GERAL</p><h2>{props.studied === 0 ? "Seu edital começa aqui" : `${props.studied} tópicos estudados`}</h2><p>O progresso aumenta quando você salva ao menos um resumo no tópico.</p></div></div><div className="stat-grid"><Stat icon={<BookOpen />} label="Tópicos estudados" value={`${props.studied} / ${props.totalTopics}`} /><Stat icon={<FileText />} label="Resumos criados" value={String(props.summaries)} /><Stat icon={<Sparkles />} label="Revisões salvas" value={String(props.reviews)} /><Stat icon={<CheckCircle2 />} label="Tópicos concluídos" value={String(props.completed)} /></div><button className="flashcard-summary" onClick={props.onFlashcards}><div><span className="mini-icon"><Layers3 /></span><p>FLASHCARDS PARA REVISAR</p><strong>{props.dueCards}</strong></div><div className="flash-stats"><span><b>{props.flashcards}</b> criados</span><span><b>{props.reviewedToday}</b> revisados hoje</span><ChevronRight /></div></button></section><div className="dashboard-columns"><section><div className="section-heading"><div><p className="kicker">POR MATÉRIA</p><h2>Seu avanço no edital</h2></div></div><div className="subject-progress-list">{curriculum.map((subject) => { const done = subject.topics.filter((topic) => props.studiedTopicIds.has(topic.id)).length; const value = Math.round(done / subject.topics.length * 100); return <button key={subject.id} onClick={() => props.onSubject(subject)}><div><span>{subject.name}</span><b>{value}%</b></div><Progress value={value} /><small>{done}/{subject.topics.length} com resumo</small></button>; })}</div></section><section className="recent-section"><p className="kicker">ATIVIDADE RECENTE</p><h2>Últimos passos</h2>{props.activities.length ? <div className="activity-list">{props.activities.slice(0, 5).map((activity) => <div key={activity.id}><span className="activity-dot" /><p><b>{activity.type}</b><span>{activity.topicName}</span><small>{activity.subjectName}</small></p></div>)}</div> : <div className="empty-state"><FileText /><p>Suas atividades aparecerão aqui.</p></div>}</section></div></div>;
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) { return <div className="stat"><span>{icon}</span><p>{label}</p><strong>{value}</strong>{sub && <small>{sub}</small>}</div>; }

function Subjects({ studiedTopicIds, onOpen }: { studiedTopicIds: Set<string>; onOpen: (subject: Subject) => void }) {
  return <div className="page"><header className="page-header compact"><div><p className="eyebrow">EDITAL VERTICALIZADO</p><h1>Matérias</h1><p>Todos os 107 tópicos, na ordem original do PDF.</p></div></header><div className="subjects-grid">{curriculum.map((subject, index) => { const done = subject.topics.filter((topic) => studiedTopicIds.has(topic.id)).length; const value = Math.round(done / subject.topics.length * 100); return <button key={subject.id} className="subject-card" onClick={() => onOpen(subject)}><span className="subject-number">{pad(index + 1)}</span><div><h2>{subject.name}</h2><p>{done} de {subject.topics.length} com resumo</p><Progress value={value} /></div><ChevronRight /></button>; })}</div></div>;
}

function SubjectView({ subject, stateMap, summaries, filter, setFilter, onBack, onTopic }: { subject: Subject; stateMap: Map<string, TopicState>; summaries: Summary[]; filter: TopicFilter; setFilter: (value: TopicFilter) => void; onBack: () => void; onTopic: (topic: Topic) => void }) {
  const hasSummary = (topicId: string) => summaries.some((summary) => summary.topicId === topicId && stripHtml(summary.contentHtml).trim()) || Boolean(stripHtml(stateMap.get(topicId)?.summaryHtml || "").trim());
  const done = subject.topics.filter((topic) => hasSummary(topic.id)).length;
  const shown = subject.topics.filter((topic) => filter === "TODOS" || filter === topic.priority || (filter === "COM RESUMO" && hasSummary(topic.id)) || (filter === "SEM RESUMO" && !hasSummary(topic.id)));
  const filters: TopicFilter[] = ["TODOS", "ALTA", "MÉDIA", "BAIXA", "COM RESUMO", "SEM RESUMO"];
  return <div className="page"><button className="back-button" onClick={onBack}><ArrowLeft /> Matérias</button><header className="subject-header"><div><p className="eyebrow">MATÉRIA</p><h1>{subject.name}</h1><p>{done}/{subject.topics.length} tópicos com resumo</p></div><div className="subject-percent"><strong>{Math.round(done / subject.topics.length * 100)}%</strong><Progress value={done / subject.topics.length * 100} /></div></header><div className="filter-row">{filters.map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="topic-list">{shown.map((topic) => { const state = stateMap.get(topic.id); const summaryTotal = summaries.filter((item) => item.topicId === topic.id).length; const studied = hasSummary(topic.id); return <button key={topic.id} className="topic-row" onClick={() => onTopic(topic)}><span className={studied ? "topic-check done" : "topic-check"}>{studied && <Check />}</span><div><p>{topic.name}</p><span className={priorityClass(topic.priority)}>{topic.priority}</span><small>{summaryTotal ? `${summaryTotal} ${summaryTotal === 1 ? "resumo salvo" : "resumos salvos"}` : state?.summaryHtml ? "1 resumo salvo" : "Sem resumo"}</small></div><ChevronRight /></button>; })}</div></div>;
}

type TopicViewProps = {
  subject: Subject; topic: Topic; state?: TopicState; summaries: Summary[]; activeSummaryId: string | null; summaryTitle: string;
  savingSummary: boolean; editorOpen: boolean; setEditorOpen: (value: boolean) => void; uploadingImage: boolean;
  selectedImage: SelectedImage | null; editorRef: React.RefObject<HTMLDivElement | null>; editorSectionRef: React.RefObject<HTMLElement | null>;
  imageInputRef: React.RefObject<HTMLInputElement | null>; reviewDraft: string; setReviewDraft: (value: string) => void;
  generatedReview: boolean; generatingReview: boolean; savingReview: boolean;
  onBack: () => void; onSelectSummary: (summary: Summary) => void; onNewSummary: () => void; onDeleteSummary: (summaryId: string) => void;
  onSummaryTitleChange: (value: string) => void; onEditorInput: () => void; onEditorClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onImageResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void; onImageResizeMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onImageResizeEnd: () => void; onImageDragStart: (event: React.DragEvent<HTMLDivElement>) => void; onImageDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onImageDrop: (event: React.DragEvent<HTMLDivElement>) => void; onUploadImage: (file: File) => void;
  onChangeImageSize: (axis: "width" | "height", value: number) => void; onToggleImageAspect: () => void; onAlignImage: (alignment: ImageAlignment) => void;
  onRemoveImage: () => void; onFormat: (command: string, value?: string) => void; onSave: () => void; onGenerate: () => void;
  onSaveReview: () => void; onToggle: (value: boolean) => void;
};

function TopicView({ subject, topic, state, summaries, activeSummaryId, summaryTitle, savingSummary, editorOpen, setEditorOpen, uploadingImage, selectedImage, editorRef, editorSectionRef, imageInputRef, reviewDraft, setReviewDraft, generatedReview, generatingReview, savingReview, onBack, onSelectSummary, onNewSummary, onDeleteSummary, onSummaryTitleChange, onEditorInput, onEditorClick, onImageResizeStart, onImageResizeMove, onImageResizeEnd, onImageDragStart, onImageDragOver, onImageDrop, onUploadImage, onChangeImageSize, onToggleImageAspect, onAlignImage, onRemoveImage, onFormat, onSave, onGenerate, onSaveReview, onToggle }: TopicViewProps) {
  const [previewSummary, setPreviewSummary] = useState<Summary | null>(null);
  const colors = ["#172033", "#2563eb", "#15803d", "#b91c1c", "#7e22ce"];
  const preserveSelection = (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault();
  const savedReviewText = summaries.find((summary) => summary.id === activeSummaryId)?.reviewText || "";
  const editingExisting = summaries.some((summary) => summary.id === activeSummaryId);

  function editSummary(summary: Summary) {
    setPreviewSummary(null);
    onSelectSummary(summary);
  }

  return <div className="page topic-page">
    <button className="back-button" onClick={onBack}><ArrowLeft /> {subject.shortName}</button>
    <header className="topic-header"><div><p className="eyebrow">{subject.name}</p><h1>{topic.name}</h1><span className={priorityClass(topic.priority)}>{topic.priority}</span></div><label className="complete-control"><Checkbox checked={Boolean(state?.completed)} onCheckedChange={(checked) => void onToggle(Boolean(checked))} /><span>{state?.completed ? "Concluído" : "Não concluído"}</span></label></header>
    <section className="saved-summaries" aria-label="Resumos salvos">
      <div className="section-heading summary-list-heading"><div><p className="kicker">{summaries.length ? `${summaries.length} ${summaries.length === 1 ? "RESUMO SALVO" : "RESUMOS SALVOS"}` : "RESUMOS DESTE TÓPICO"}</p><h2>Seus resumos</h2></div><Button type="button" className="add-summary-button" disabled={savingSummary} onClick={onNewSummary}><Plus /> Adicionar novo resumo</Button></div>
      {summaries.length ? <div className="saved-summary-grid">{summaries.map((summary) => <article className="saved-summary-card" key={summary.id}>
        <div className="saved-summary-main">
          <span className="saved-summary-icon"><FileText /></span>
          <span className="saved-summary-copy"><b>Resumo salvo</b><strong>{summary.title}</strong><span>{subject.shortName} • {topic.name}</span><small>{summaryUpdatedLabel(summary.updatedAt)}</small></span>
          <ChevronRight />
        </div>
        <div className="saved-summary-actions">
          <Button type="button" variant="outline" onClick={() => setPreviewSummary(summary)}><BookOpen /> Abrir</Button>
          <Button type="button" variant="outline" disabled={savingSummary} onClick={() => editSummary(summary)}><NotebookPen /> Editar</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button type="button" variant="outline" className="delete-summary-button" disabled={savingSummary}><Trash2 /> Excluir</Button></AlertDialogTrigger>
            <AlertDialogContent size="sm"><AlertDialogHeader><AlertDialogTitle>Excluir este resumo?</AlertDialogTitle><AlertDialogDescription>O texto e as imagens deste resumo serão removidos definitivamente. Os outros resumos do tópico permanecerão intactos.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => onDeleteSummary(summary.id)}>Excluir resumo</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
          </AlertDialog>
        </div>
      </article>)}</div> : <div className="saved-summary-empty"><FileText /><p>Nenhum resumo salvo neste tópico.</p></div>}
    </section>
    <Dialog open={Boolean(previewSummary)} onOpenChange={(open) => { if (!open) setPreviewSummary(null); }}>
      <DialogContent className="summary-preview-dialog">
        <DialogHeader><DialogTitle>{previewSummary?.title || "Resumo"}</DialogTitle><DialogDescription>{subject.name} • {topic.name}{previewSummary ? ` • ${summaryUpdatedLabel(previewSummary.updatedAt)}` : ""}</DialogDescription></DialogHeader>
        <div className="summary-preview-content" dangerouslySetInnerHTML={{ __html: previewSummary?.contentHtml || "" }} />
        {previewSummary?.reviewText && <div className="summary-preview-review"><p className="kicker">REVISÃO APRIMORADA</p><p>{previewSummary.reviewText}</p></div>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setPreviewSummary(null)}>Fechar</Button>{previewSummary && <Button type="button" onClick={() => editSummary(previewSummary)}><NotebookPen /> Editar resumo</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
    {editorOpen && <section className="editor-section" ref={editorSectionRef}>
      <div className="section-heading"><div><p className="kicker">{editingExisting ? "EDITANDO RESUMO" : "NOVO RESUMO"}</p><h2>{editingExisting ? `Editar ${summaryTitle}` : "Escreva e organize do seu jeito"}</h2></div><span className={savingSummary ? "save-state saving" : "save-state"}>{savingSummary ? "Salvando…" : "Salvamento manual"}</span></div>
      <div className={editingExisting ? "summary-edit-mode editing" : "summary-edit-mode"}><span>{editingExisting ? "As alterações serão aplicadas somente a este resumo." : "Ao salvar, um novo resumo independente será criado."}</span></div>
      <label className="summary-title-field">Nome do resumo<input value={summaryTitle} maxLength={120} disabled={savingSummary} onChange={(event) => onSummaryTitleChange(event.target.value)} placeholder="Ex.: Conceitos principais" /></label>
      <div className="editor-shell">
        <div className="editor-toolbar" aria-label="Formatação do resumo">
          <div className="toolbar-group" aria-label="Estrutura">
            <button type="button" title="Título" aria-label="Título" onMouseDown={preserveSelection} onClick={() => onFormat("formatBlock", "h1")}><Heading1 /></button>
            <button type="button" title="Subtítulo" aria-label="Subtítulo" onMouseDown={preserveSelection} onClick={() => onFormat("formatBlock", "h2")}><Heading2 /></button>
            <button type="button" title="Texto normal" aria-label="Texto normal" onMouseDown={preserveSelection} onClick={() => onFormat("formatBlock", "p")}><Pilcrow /></button>
          </div>
          <div className="toolbar-group" aria-label="Estilo">
            <button type="button" title="Negrito" aria-label="Negrito" onMouseDown={preserveSelection} onClick={() => onFormat("bold")}><Bold /></button>
            <button type="button" title="Itálico" aria-label="Itálico" onMouseDown={preserveSelection} onClick={() => onFormat("italic")}><Italic /></button>
            <button type="button" title="Sublinhar" aria-label="Sublinhar" onMouseDown={preserveSelection} onClick={() => onFormat("underline")}><Underline /></button>
            <button type="button" title="Destacar em amarelo" aria-label="Destacar em amarelo" onMouseDown={preserveSelection} onClick={() => onFormat("hiliteColor", "#fef08a")}><Highlighter /></button>
          </div>
          <div className="toolbar-group" aria-label="Listas">
            <button type="button" title="Lista com marcadores" aria-label="Lista com marcadores" onMouseDown={preserveSelection} onClick={() => onFormat("insertUnorderedList")}><List /></button>
            <button type="button" title="Lista numerada" aria-label="Lista numerada" onMouseDown={preserveSelection} onClick={() => onFormat("insertOrderedList")}><ListOrdered /></button>
          </div>
          <div className="toolbar-group color-swatches" aria-label="Cor do texto">
            {colors.map((color) => <button type="button" key={color} title={`Cor ${color}`} aria-label={`Usar cor ${color}`} onMouseDown={preserveSelection} onClick={() => onFormat("foreColor", color)}><span style={{ backgroundColor: color }} /></button>)}
          </div>
          <div className="toolbar-group">
            <button type="button" title="Adicionar imagem" aria-label="Adicionar imagem" disabled={uploadingImage} onMouseDown={preserveSelection} onClick={() => imageInputRef.current?.click()}>{uploadingImage ? <RotateCw className="spin" /> : <ImagePlus />}</button>
            <button type="button" title="Limpar formatação" aria-label="Limpar formatação" onMouseDown={preserveSelection} onClick={() => onFormat("removeFormat")}><Eraser /></button>
          </div>
        </div>
        <input ref={imageInputRef} className="image-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadImage(file); }} />
        {selectedImage && <div className="image-controls" contentEditable={false}>
          <span className="image-move-hint"><Move /> Arraste a imagem para reposicionar</span>
          <label>Largura <input type="number" min="80" max="1200" value={selectedImage.width} onChange={(event) => onChangeImageSize("width", Number(event.target.value))} /> px</label>
          <label>Altura <input type="number" min="60" max="1600" value={selectedImage.height} onChange={(event) => onChangeImageSize("height", Number(event.target.value))} /> px</label>
          <button type="button" className={selectedImage.lockAspect ? "active" : ""} onClick={onToggleImageAspect} title="Manter proporção">{selectedImage.lockAspect ? <Lock /> : <Unlock />} Proporção</button>
          <span className="image-align-buttons" aria-label="Alinhar imagem">
            <button type="button" className={selectedImage.alignment === "left" ? "active" : ""} onClick={() => onAlignImage("left")} title="Alinhar à esquerda"><AlignLeft /></button>
            <button type="button" className={selectedImage.alignment === "center" ? "active" : ""} onClick={() => onAlignImage("center")} title="Centralizar"><AlignCenter /></button>
            <button type="button" className={selectedImage.alignment === "right" ? "active" : ""} onClick={() => onAlignImage("right")} title="Alinhar à direita"><AlignRight /></button>
          </span>
          <button type="button" className="remove-image-button" onClick={onRemoveImage}><Trash2 /> Remover imagem</button>
        </div>}
        <div ref={editorRef} className="summary-editor" contentEditable={!savingSummary} suppressContentEditableWarning data-placeholder="Comece a escrever este resumo…" onInput={onEditorInput} onClick={onEditorClick} onPointerDown={onImageResizeStart} onPointerMove={onImageResizeMove} onPointerUp={onImageResizeEnd} onPointerCancel={onImageResizeEnd} onDragStart={onImageDragStart} onDragOver={onImageDragOver} onDrop={onImageDrop} />
      </div>
      <div className="summary-actions">
        <Button className="save-button" onClick={onSave} disabled={savingSummary || uploadingImage}>{savingSummary ? <><RotateCw className="spin" /> Salvando…</> : editingExisting ? "Salvar alterações" : "Salvar novo resumo"}</Button>
        {editingExisting && activeSummaryId && <AlertDialog>
          <AlertDialogTrigger asChild><Button type="button" variant="outline" className="delete-summary-button" disabled={savingSummary}><Trash2 /> Excluir</Button></AlertDialogTrigger>
          <AlertDialogContent size="sm"><AlertDialogHeader><AlertDialogTitle>Excluir este resumo?</AlertDialogTitle><AlertDialogDescription>O texto e as imagens deste resumo serão removidos definitivamente. Os outros resumos do tópico permanecerão intactos.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => onDeleteSummary(activeSummaryId)}>Excluir resumo</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>}
        <Button type="button" variant="ghost" className="close-editor-button" onClick={() => setEditorOpen(false)}>Fechar</Button>
      </div>
      {editingExisting && <section className="review-section embedded-review" aria-label="Revisão deste resumo" aria-busy={generatingReview || savingReview}><div className="review-title"><span><Sparkles /></span><div><p className="kicker">APRIMORAR COM IA</p><h2>Seu resumo, mais claro e direto</h2></div></div>{reviewDraft ? <><Textarea value={reviewDraft} onChange={(event) => setReviewDraft(event.target.value)} className="review-textarea" disabled={generatingReview || savingReview} />{savedReviewText !== reviewDraft && <p className="review-note">{generatedReview ? "Aprimoramento pronto. Confira antes de salvar." : "Há alterações ainda não salvas nesta revisão."}</p>}<div className="review-actions"><Button onClick={onSaveReview} disabled={generatingReview || savingReview || reviewDraft.trim().length < 20}>{savingReview ? <><RotateCw className="spin" /> Salvando…</> : "Salvar revisão"}</Button><Button variant="outline" disabled={generatingReview || savingReview} onClick={() => navigator.clipboard.writeText(reviewDraft)}><Copy /> Copiar</Button><Button variant="ghost" disabled={generatingReview || savingReview} onClick={onGenerate}><RotateCw className={generatingReview ? "spin" : undefined} /> {generatingReview ? "Aprimorando…" : "Aprimorar novamente"}</Button></div></> : <div className="review-empty"><p>O ChatGPT descomplica suas anotações e cria uma revisão curta. Os flashcards são gerados separadamente no Caderno de Erros.</p><Button onClick={onGenerate} disabled={generatingReview}><Sparkles /> {generatingReview ? "Aprimorando resumo…" : "Aprimorar resumo com ChatGPT"}</Button></div>}</section>}
    </section>}
  </div>;
}

function ScheduleView({ blocks, settings, saving, onGenerate, onUpdate, onAdd, onDelete, onMove }: {
  blocks: ScheduleBlock[];
  settings: ScheduleSettings;
  saving: boolean;
  onGenerate: (days: ScheduleDay[], minutesPerDay: number, subjectIds: string[]) => Promise<boolean>;
  onUpdate: (id: string, patch: Partial<Pick<ScheduleBlock, "day" | "subjectId" | "startMinutes" | "durationMinutes">>) => void;
  onAdd: (day: ScheduleDay) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDays, setSelectedDays] = useState<ScheduleDay[]>(settings.availableDays);
  const [hoursPerDay, setHoursPerDay] = useState(settings.minutesPerDay / 60);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(settings.includedSubjectIds);

  function openGenerator() {
    setSelectedDays(settings.availableDays.length ? settings.availableDays : defaultScheduleSettings.availableDays);
    setHoursPerDay(settings.minutesPerDay / 60 || 3);
    setSelectedSubjects(settings.includedSubjectIds.length ? settings.includedSubjectIds : curriculum.map((subject) => subject.id));
    setDialogOpen(true);
  }

  function toggleDay(day: ScheduleDay, checked: boolean) {
    setSelectedDays((current) => checked ? [...current, day].sort((a, b) => scheduleDays.findIndex((item) => item.id === a) - scheduleDays.findIndex((item) => item.id === b)) : current.filter((item) => item !== day));
  }

  function toggleSubject(subjectId: string, checked: boolean) {
    setSelectedSubjects((current) => checked ? [...current, subjectId] : current.filter((item) => item !== subjectId));
  }

  async function submitGeneration() {
    const ok = await onGenerate(selectedDays, Math.round(hoursPerDay * 60), selectedSubjects);
    if (ok) setDialogOpen(false);
  }

  const totals = curriculum.map((subject) => ({
    subject,
    minutes: blocks.filter((block) => block.subjectId === subject.id).reduce((sum, block) => sum + block.durationMinutes, 0),
  })).filter((item) => item.minutes > 0);
  const weeklyMinutes = blocks.reduce((sum, block) => sum + block.durationMinutes, 0);

  return <div className="page schedule-page">
    <header className="page-header schedule-header">
      <div><p className="eyebrow">PLANEJAMENTO SEMANAL</p><h1>Cronograma</h1><p>Organize as matérias do edital nos seus horários disponíveis.</p></div>
      <Button type="button" onClick={openGenerator}><CalendarDays /> Gerar cronograma</Button>
    </header>

    <section className="schedule-summary" aria-label="Carga horária planejada">
      <div className="schedule-total"><span><Clock3 /></span><div><p>CARGA SEMANAL TOTAL</p><strong>{formatDuration(weeklyMinutes)}</strong><small>{blocks.length} {blocks.length === 1 ? "bloco planejado" : "blocos planejados"}</small></div></div>
      <div className="subject-hour-list">
        {totals.length ? totals.map(({ subject, minutes }) => <div key={subject.id}><span>{subject.shortName}</span><i /><strong>{formatDuration(minutes)}/semana</strong></div>) : <p>Gere seu primeiro cronograma ou adicione um bloco em qualquer dia.</p>}
      </div>
    </section>

    <div className="schedule-save-state" role="status"><span className={saving ? "saving-dot active" : "saving-dot"} />{saving ? "Salvando alterações…" : "Alterações salvas automaticamente"}</div>

    <section className="schedule-grid" aria-label="Cronograma da semana">
      {scheduleDays.map((day) => {
        const dayBlocks = blocks.filter((block) => block.day === day.id).sort((a, b) => a.position - b.position || a.startMinutes - b.startMinutes);
        const dayMinutes = dayBlocks.reduce((sum, block) => sum + block.durationMinutes, 0);
        return <article className="day-card" key={day.id}>
          <header><div><span>{day.short}</span><div><h2>{day.label}</h2><p>{dayMinutes ? formatDuration(dayMinutes) : "Sem estudos"}</p></div></div><Button type="button" variant="ghost" size="icon" disabled={saving} onClick={() => onAdd(day.id)} title={`Adicionar estudo em ${day.label}`} aria-label={`Adicionar estudo em ${day.label}`}><Plus /></Button></header>
          <div className="day-blocks">
            {dayBlocks.length ? dayBlocks.map((block, index) => {
              const subject = curriculum.find((item) => item.id === block.subjectId) || curriculum[0];
              return <div className="study-block" key={block.id}>
                <div className="study-block-title"><span className="study-color" /><strong>{subject.name}</strong><span>{formatDuration(block.durationMinutes)}</span></div>
                <div className="study-block-fields">
                  <label>Matéria<select value={block.subjectId} disabled={saving} onChange={(event) => onUpdate(block.id, { subjectId: event.target.value })}>{curriculum.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label>Dia<select value={block.day} disabled={saving} onChange={(event) => onUpdate(block.id, { day: event.target.value as ScheduleDay })}>{scheduleDays.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                  <label>Horário<input type="time" value={minutesToTime(block.startMinutes)} disabled={saving} onChange={(event) => onUpdate(block.id, { startMinutes: timeToMinutes(event.target.value) })} /></label>
                  <label>Duração<select value={block.durationMinutes} disabled={saving} onChange={(event) => onUpdate(block.id, { durationMinutes: Number(event.target.value) })}>{[30, 45, 60, 90, 120, 150, 180].map((minutes) => <option key={minutes} value={minutes}>{formatDuration(minutes)}</option>)}</select></label>
                </div>
                <div className="study-block-actions">
                  <button type="button" disabled={saving || index === 0} onClick={() => onMove(block.id, -1)} title="Mover para cima" aria-label="Mover bloco para cima"><ChevronUp /></button>
                  <button type="button" disabled={saving || index === dayBlocks.length - 1} onClick={() => onMove(block.id, 1)} title="Mover para baixo" aria-label="Mover bloco para baixo"><ChevronDown /></button>
                  <button type="button" className="delete-block" disabled={saving} onClick={() => onDelete(block.id)} title="Excluir bloco" aria-label={`Excluir ${subject.name}`}><Trash2 /></button>
                </div>
              </div>;
            }) : <div className="day-empty"><p>Nenhum bloco neste dia.</p><button type="button" disabled={saving} onClick={() => onAdd(day.id)}><Plus /> Adicionar matéria</button></div>}
          </div>
        </article>;
      })}
    </section>

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="schedule-dialog">
        <DialogHeader><DialogTitle>Gerar cronograma</DialogTitle><DialogDescription>Escolha sua disponibilidade. As matérias vêm diretamente do edital cadastrado.</DialogDescription></DialogHeader>
        <div className="generator-form">
          <fieldset><legend>Dias disponíveis</legend><div className="generator-days">{scheduleDays.map((day) => <label key={day.id}><Checkbox checked={selectedDays.includes(day.id)} onCheckedChange={(checked) => toggleDay(day.id, Boolean(checked))} /><span>{day.short}</span></label>)}</div></fieldset>
          <label className="hours-field">Horas disponíveis por dia<input type="number" min="0.5" max="12" step="0.5" value={hoursPerDay} onChange={(event) => setHoursPerDay(Math.max(.5, Math.min(12, Number(event.target.value) || .5)))} /></label>
          <fieldset><legend>Matérias incluídas</legend><div className="generator-subject-tools"><button type="button" onClick={() => setSelectedSubjects(curriculum.map((subject) => subject.id))}>Selecionar todas</button><button type="button" onClick={() => setSelectedSubjects([])}>Limpar</button></div><div className="generator-subjects">{curriculum.map((subject) => <label key={subject.id}><Checkbox checked={selectedSubjects.includes(subject.id)} onCheckedChange={(checked) => toggleSubject(subject.id, Boolean(checked))} /><span>{subject.name}</span></label>)}</div></fieldset>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={() => void submitGeneration()} disabled={saving || !selectedDays.length || !selectedSubjects.length}>{saving ? <><RotateCw className="spin" /> Gerando…</> : "Gerar cronograma"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function FlashcardsView({ cards, filtered, current, revealed, setRevealed, dueOnly, setDueOnly, subject, setSubject, topic, setTopic, priority, setPriority, onReview }: { cards: Flashcard[]; filtered: Flashcard[]; current?: Flashcard; revealed: boolean; setRevealed: (value: boolean) => void; dueOnly: boolean; setDueOnly: (value: boolean) => void; subject: string; setSubject: (value: string) => void; topic: string; setTopic: (value: string) => void; priority: "TODAS" | Priority; setPriority: (value: "TODAS" | Priority) => void; onReview: (card: Flashcard, remembered: boolean) => void }) {
  const subjectTopics = curriculum.find((item) => item.name === subject)?.topics || [];
  return <div className="page flashcards-page"><header className="page-header compact"><div><p className="eyebrow">REPETIÇÃO ESPAÇADA</p><h1>Flashcards</h1><p>{filtered.length} cartões nesta seleção.</p></div></header><section className="flash-filters"><div className="segmented"><button className={dueOnly ? "active" : ""} onClick={() => { setDueOnly(true); setRevealed(false); }}>PARA REVISAR</button><button className={!dueOnly ? "active" : ""} onClick={() => { setDueOnly(false); setRevealed(false); }}>TODOS</button></div><div className="select-row"><label>Matéria<select value={subject} onChange={(event) => setSubject(event.target.value)}><option value="TODAS">Todas</option>{curriculum.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label><label>Tópico<select value={topic} onChange={(event) => setTopic(event.target.value)} disabled={subject === "TODAS"}><option value="TODOS">Todos</option>{subjectTopics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="filter-row small">{(["TODAS", "ALTA", "MÉDIA", "BAIXA"] as const).map((item) => <button key={item} className={priority === item ? "active" : ""} onClick={() => setPriority(item)}>{item}</button>)}</div></section>{current ? <section className={revealed ? "flashcard revealed" : "flashcard"}><div className="flashcard-meta"><span>{current.subjectName}</span><span className={priorityClass(current.priority)}>{current.priority}</span></div><p className="flash-side">{revealed ? "RESPOSTA" : "PERGUNTA"}</p><h2>{revealed ? current.answer : current.question}</h2><small>{current.sourceErrorId ? "Caderno de erros • " : ""}{current.topicName}</small>{revealed ? <div className="recall-actions"><Button variant="outline" onClick={() => void onReview(current, false)}>Não lembrei</Button><Button onClick={() => void onReview(current, true)}>Lembrei</Button></div> : <Button className="reveal-button" onClick={() => setRevealed(true)}>Mostrar resposta</Button>}</section> : <div className="flash-empty"><CheckCircle2 /><h2>{cards.length ? "Tudo revisado por agora" : "Seus flashcards aparecerão aqui"}</h2><p>{cards.length ? "Os próximos cartões voltarão automaticamente no momento certo." : "Registre uma correção no Caderno de Erros para criar cartões curtos automaticamente."}</p></div>}</div>;
}
