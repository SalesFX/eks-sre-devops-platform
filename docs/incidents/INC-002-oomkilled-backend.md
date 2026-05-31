# INC-002: OOMKilled Backend

**Data:** 2026-05-22
**Duracao:** 8 minutos (09:12 a 09:20 UTC) — degradacao intermitente
**Severidade:** SEV2
**Status:** Resolved
**Servicos afetados:** backend (intermitente — uma das 2 replicas em crash loop)

---

## Linha do tempo

| Hora (UTC) | Evento |
|---|---|
| 09:12 | Pod `backend-b9d8f4bf6-db4fr` e encerrado com `OOMKilled` |
| 09:12 | ArgoCD detecta pod unhealthy, Application vai para `Degraded` |
| 09:13 | Kubernetes tenta reiniciar o pod (CrashLoopBackOff) |
| 09:14 | Pod restante (1/2) absorve todo o trafego; ALB redireciona |
| 09:15 | Grafana mostra pico de memoria em `backend` chegando a 510Mi (limite: 512Mi) |
| 09:16 | On-call identifica `OOMKilled` via `kubectl describe pod` |
| 09:17 | Identificada query Prisma sem `take` retornando todos os incidentes |
| 09:18 | Hotfix commitado: `findMany` com `take: 100` |
| 09:19 | CI builda e atualiza kustomization; ArgoCD sincroniza |
| 09:20 | Ambos os pods voltam a Running; Application volta para Healthy |

## Sintomas observados

- Um pod do backend em `CrashLoopBackOff` com `Reason: OOMKilled`
- Servico degradado mas nao indisponivel (1 replica ainda ativa)
- PodDisruptionBudget garantiu `minAvailable: 1` durante o ciclo de crash

## Causa raiz

A rota `GET /backend/incidents` executava `prisma.incident.findMany()` sem clausula `take`. Com o crescimento dos dados de teste (mais de 2.000 registros inseridos durante testes de carga), a query retornava todos os registros em uma unica resposta, alocando ~450 MB de memoria no processo Node.js. Somado ao overhead base da aplicacao (~80 MB), o total ultrapassou o limite de 512 Mi configurado.

## Resolucao imediata

```typescript
// Antes (causando OOM)
const incidents = await prisma.incident.findMany()

// Depois (paginado)
const incidents = await prisma.incident.findMany({
  take: 100,
  skip: cursor ? 1 : 0,
  cursor: cursor ? { id: cursor } : undefined,
  orderBy: { createdAt: 'desc' }
})
```

## Analise de impacto

- 8 minutos de degradacao (1 replica operacional durante todo o incidente)
- Nenhum request perdido (Kubernetes redistribuiu o trafego automaticamente)
- PDB funcionou conforme projetado — nunca ficamos com 0 replicas

## Acoes pos-incidente

- [x] Adicionar paginacao (cursor-based) em todas as rotas `findMany` do Prisma
- [x] Adicionar linting custom para detectar `findMany` sem `take` (via Semgrep)
- [x] Aumentar limite de memoria do backend de 512Mi para 768Mi como buffer
- [ ] Implementar alertas de memoria em 80% do limite no Grafana
- [ ] Testes de carga automatizados na pipeline para detectar regressoes de memoria

## Licoes aprendidas

1. Limites de memoria dimensionados para carga "esperada" falham quando o volume de dados cresce — revisar limites com base em dados reais
2. PDB com `minAvailable: 1` e `podAntiAffinity` garantiram resiliencia real durante o incidente
3. A ausencia de testes de carga na pipeline permite que regressoes de performance passem para producao
