"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, NotebookPen, Pencil, Plus, RotateCw, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { curriculum, type Priority } from "@/lib/curriculum";

export type ErrorNote = {
  id: string;
  topicId: string;
  subjectId: string;
  subjectName: string;
  topicName: string;
  priority: Priority;
  title: string;
  mistake: string;
  correctAnswer: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
};

type ErrorCardRef = { sourceErrorId: string | null };

const initialSubjectId = curriculum[0]?.id || "";
const initialTopicId = curriculum[0]?.topics[0]?.id || "";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function ErrorNotebook({ notes, cards, onChanged, onStatus }: {
  notes: ErrorNote[];
  cards: ErrorCardRef[];
  onChanged: () => Promise<void>;
  onStatus: (message: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const [topicId, setTopicId] = useState(initialTopicId);
  const [title, setTitle] = useState("");
  const [mistake, setMistake] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState("TODAS");

  const subject = curriculum.find((item) => item.id === subjectId) || curriculum[0];
  const topics = subject?.topics || [];
  const visibleNotes = useMemo(() => notes.filter((note) => subjectFilter === "TODAS" || note.subjectId === subjectFilter), [notes, subjectFilter]);
  const cardCount = (errorId: string) => cards.filter((card) => card.sourceErrorId === errorId).length;

  function resetForm() {
    setEditingId(null);
    setSubjectId(initialSubjectId);
    setTopicId(initialTopicId);
    setTitle("");
    setMistake("");
    setCorrectAnswer("");
    setReason("");
  }

  function changeSubject(nextSubjectId: string) {
    const nextSubject = curriculum.find((item) => item.id === nextSubjectId);
    setSubjectId(nextSubjectId);
    setTopicId(nextSubject?.topics[0]?.id || "");
  }

  function editNote(note: ErrorNote) {
    setEditingId(note.id);
    setSubjectId(note.subjectId);
    setTopicId(note.topicId);
    setTitle(note.title);
    setMistake(note.mistake);
    setCorrectAnswer(note.correctAnswer);
    setReason(note.reason);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    if (busy) return;
    if (!topicId || mistake.trim().length < 8 || correctAnswer.trim().length < 8) {
      onStatus("Selecione o tópico e descreva o erro e a resposta correta.");
      return;
    }
    setBusy(true);
    onStatus(editingId ? "Salvando as alterações…" : "Salvando o erro e criando os flashcards com IA…");
    try {
      const response = await fetch("/api/study", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editingId ? "errorUpdate" : "createError",
          errorId: editingId,
          subjectId,
          topicId,
          title,
          mistake,
          correctAnswer,
          reason,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; flashcards?: unknown[] };
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar este erro.");
      const wasEditing = Boolean(editingId);
      resetForm();
      await onChanged();
      onStatus(wasEditing
        ? "Erro atualizado. Use “Gerar novamente” apenas se quiser atualizar também os flashcards."
        : `Erro salvo e ${result.flashcards?.length || 0} flashcard(s) criado(s).`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Não foi possível salvar este erro agora.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(note: ErrorNote) {
    if (regeneratingId) return;
    setRegeneratingId(note.id);
    onStatus("O ChatGPT está atualizando os flashcards deste erro…");
    try {
      const response = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerateError", errorId: note.id }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; flashcards?: unknown[] };
      if (!response.ok) throw new Error(result.error || "Não foi possível gerar novamente.");
      await onChanged();
      onStatus(`${result.flashcards?.length || 0} flashcard(s) atualizado(s) para este erro.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Não foi possível conectar à IA agora.");
    } finally {
      setRegeneratingId(null);
    }
  }

  async function deleteNote(note: ErrorNote) {
    setBusy(true);
    try {
      const response = await fetch("/api/study", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "error", errorId: note.id }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível excluir este erro.");
      if (editingId === note.id) resetForm();
      await onChanged();
      onStatus("Erro e seus flashcards foram excluídos.");
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Não foi possível excluir este erro agora.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="page errors-page">
    <header className="page-header errors-header">
      <div><p className="eyebrow">APRENDER COM OS ERROS</p><h1>Caderno de erros</h1><p>Registre a correção. A IA transforma somente o essencial em flashcards curtos.</p></div>
      <div className="error-total"><NotebookPen /><strong>{notes.length}</strong><span>{notes.length === 1 ? "erro salvo" : "erros salvos"}</span></div>
    </header>

    <div className="errors-layout">
      <section className="error-form-card" aria-busy={busy}>
        <div className="error-form-title"><span><AlertTriangle /></span><div><p className="kicker">{editingId ? "EDITANDO REGISTRO" : "NOVO REGISTRO"}</p><h2>{editingId ? "Corrija suas anotações" : "O que você errou?"}</h2></div>{editingId && <button type="button" onClick={resetForm} aria-label="Cancelar edição"><X /></button>}</div>
        <div className="error-form-grid">
          <label>Matéria<select value={subjectId} disabled={busy} onChange={(event) => changeSubject(event.target.value)}>{curriculum.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Tópico<select value={topicId} disabled={busy} onChange={(event) => setTopicId(event.target.value)}>{topics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="full-field">Título curto <input value={title} disabled={busy} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Confundi regra da crase" /></label>
          <label className="full-field">O que eu errei? <Textarea value={mistake} disabled={busy} maxLength={4000} onChange={(event) => setMistake(event.target.value)} placeholder="Escreva a alternativa marcada ou a ideia que você confundiu." /></label>
          <label className="full-field correct-field">Qual é a resposta correta? <Textarea value={correctAnswer} disabled={busy} maxLength={4000} onChange={(event) => setCorrectAnswer(event.target.value)} placeholder="Anote a regra ou resposta correta com suas palavras." /></label>
          <label className="full-field">Por que eu errei? <Textarea value={reason} disabled={busy} maxLength={2400} onChange={(event) => setReason(event.target.value)} placeholder="Opcional: distração, conceito confundido, exceção esquecida…" /></label>
        </div>
        <Button type="button" className="error-save-button" disabled={busy} onClick={() => void submit()}>{busy ? <><RotateCw className="spin" /> Salvando…</> : editingId ? <><CheckCircle2 /> Salvar alterações</> : <><Sparkles /> Salvar erro e gerar flashcards</>}</Button>
        <p className="error-cost-note">A OpenAI é chamada uma vez ao criar o erro. Editar o texto não gera nova cobrança.</p>
      </section>

      <section className="error-list-section">
        <div className="error-list-toolbar"><div><p className="kicker">REGISTROS SALVOS</p><h2>Erros para não repetir</h2></div><label>Filtrar<select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="TODAS">Todas as matérias</option>{curriculum.map((item) => <option key={item.id} value={item.id}>{item.shortName}</option>)}</select></label></div>
        {visibleNotes.length ? <div className="error-note-list">{visibleNotes.map((note) => {
          const generatedCards = cardCount(note.id);
          return <article className="error-note-card" key={note.id}>
            <div className="error-note-rule" />
            <header><div><span>{note.subjectName}</span><h3>{note.title}</h3><small>{note.topicName}</small></div><time dateTime={note.updatedAt}>{dateLabel(note.updatedAt)}</time></header>
            <div className="error-note-answer"><b>Correção</b><p>{note.correctAnswer}</p></div>
            <footer><span><LayersBadge /> {generatedCards} {generatedCards === 1 ? "flashcard" : "flashcards"}</span><div><Button type="button" variant="ghost" size="sm" disabled={busy || Boolean(regeneratingId)} onClick={() => editNote(note)}><Pencil /> Editar</Button><Button type="button" variant="outline" size="sm" disabled={busy || Boolean(regeneratingId)} onClick={() => void regenerate(note)}><RotateCw className={regeneratingId === note.id ? "spin" : undefined} /> {regeneratingId === note.id ? "Gerando…" : "Gerar novamente"}</Button><AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" size="icon" disabled={busy || Boolean(regeneratingId)} aria-label={`Excluir ${note.title}`}><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent size="sm"><AlertDialogHeader><AlertDialogTitle>Excluir este erro?</AlertDialogTitle><AlertDialogDescription>O registro e os flashcards criados a partir dele serão removidos definitivamente.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void deleteNote(note)}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></footer>
          </article>;
        })}</div> : <div className="error-empty"><NotebookPen /><h2>Nenhum erro registrado</h2><p>Use o formulário para salvar a primeira correção e criar seus flashcards.</p><Button type="button" variant="outline" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><Plus /> Registrar erro</Button></div>}
      </section>
    </div>
  </div>;
}

function LayersBadge() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>;
}
