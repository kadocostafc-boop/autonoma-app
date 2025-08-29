// report-routes.js
// Rotas de Denúncias para Autônoma.app
const path = require("path");
const fs = require("fs");

module.exports = function attachReportRoutes(app, deps) {
  const { DATA_DIR, readJSON, writeJSON, requireAdmin } = deps;

  const REPORTS_FILE = path.join(DATA_DIR, "denuncias.json");
  if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, "[]", "utf8");

  const safeTrim = (v) => (v ?? "").toString().trim();
  const onlyDigits = (v) => safeTrim(v).replace(/\D/g, "");
  const validEmail = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  function readReports() {
    try {
      return JSON.parse(fs.readFileSync(REPORTS_FILE, "utf8"));
    } catch {
      return [];
    }
  }
  function writeReports(data) {
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(data, null, 2), "utf8");
  }

  // PUBLIC — Enviar denúncia
  app.post("/api/report", expressJsonGuard, (req, res) => {
    try {
      const body = req.body || {};
      const payload = {
        profile: safeTrim(body.profile),
        cidade: safeTrim(body.cidade),
        tipo: safeTrim(body.tipo),
        evidencias: safeTrim(body.evidencias),
        detalhes: safeTrim(body.detalhes),
        email: safeTrim(body.email),
        telefone: onlyDigits(body.telefone),
      };

      const errors = [];
      if (!payload.profile) errors.push("Informe link do perfil ou ID.");
      if (!payload.tipo) errors.push("Selecione o motivo da denúncia.");
      if (!payload.detalhes || payload.detalhes.length < 10) errors.push("Detalhe o problema (mín. 10 caracteres).");
      if (!validEmail(payload.email)) errors.push("E-mail inválido.");

      if (errors.length) {
        return res.status(400).json({ ok: false, errors });
      }

      const db = readReports();
      const nextId = db.reduce((m, r) => Math.max(m, Number(r.id || 0)), 0) + 1;

      const entry = {
        id: nextId,
        createdAt: new Date().toISOString(),
        status: "aberta", // aberta | resolvida
        ...payload,
        adminNotes: "",
        resolvedAt: null,
      };

      db.push(entry);
      writeReports(db);

      return res.json({ ok: true, id: nextId });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
  });

  // ADMIN — Listar
  app.get("/api/admin/denuncias", requireAdmin, (req, res) => {
    const { q = "", status = "all", page = "1", limit = "20" } = req.query;
    const p = clampInt(page, 1, 9999);
    const l = clampInt(limit, 1, 100);

    const qn = norm(q);
    const all = readReports();

    let list = all.filter((r) => {
      const okQ = qn
        ? [r.profile, r.cidade, r.tipo, r.detalhes, r.email, r.telefone]
            .map((v) => norm(String(v || "")))
            .some((s) => s.includes(qn))
        : true;
      let okS = true;
      if (status === "aberta") okS = r.status === "aberta";
      else if (status === "resolvida") okS = r.status === "resolvida";
      return okQ && okS;
    });

    // mais recentes primeiro
    list.sort((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? -1 : 1));

    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / l));
    const pageNow = Math.min(p, pages);
    const items = list.slice((pageNow - 1) * l, (pageNow - 1) * l + l);
    res.json({ items, total, page: pageNow, pages, limit: l });
  });

  // ADMIN — Detalhar 1
  app.get("/api/admin/denuncias/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const db = readReports();
    const r = db.find((x) => Number(x.id) === id);
    if (!r) return res.status(404).json({ ok: false, error: "Não encontrada" });
    res.json({ ok: true, item: r });
  });

  // ADMIN — Marcar como resolvida / reabrir / anotar
  app.post("/api/admin/denuncias/:id/update", requireAdmin, expressJsonGuard, (req, res) => {
    const id = Number(req.params.id);
    const { status, adminNotes } = req.body || {};
    const db = readReports();
    const r = db.find((x) => Number(x.id) === id);
    if (!r) return res.status(404).json({ ok: false, error: "Não encontrada" });

    if (status === "resolvida" && r.status !== "resolvida") {
      r.status = "resolvida";
      r.resolvedAt = new Date().toISOString();
    } else if (status === "aberta" && r.status !== "aberta") {
      r.status = "aberta";
      r.resolvedAt = null;
    }

    if (typeof adminNotes === "string") {
      r.adminNotes = adminNotes;
    }

    writeReports(db);
    res.json({ ok: true });
  });

  // ADMIN — Excluir
  app.delete("/api/admin/denuncias/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const db = readReports();
    const idx = db.findIndex((x) => Number(x.id) === id);
    if (idx < 0) return res.status(404).json({ ok: false, error: "Não encontrada" });
    db.splice(idx, 1);
    writeReports(db);
    res.json({ ok: true });
  });

  // Helpers locais
  function norm(s) {
    return (s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }
  function clampInt(v, min, max) {
    let n = parseInt(String(v), 10);
    if (!Number.isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }
  function expressJsonGuard(req, res, next) {
    // Se o app principal já tem app.use(express.json(...)) tudo certo; isso é só um fallback seguro
    if (req.body && typeof req.body === "object") return next();
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch {
        req.body = {};
      }
      next();
    });
  }
};