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

---

## Simulacao em producao — 2026-06-01

**Severidade:** Critico
**MTTR: ~4 minutos**

| Horario (BRT) | Evento |
|---|---|
| 15:06:54 | Pod `oom-demo` criado com memory limit de `10Mi` e script que aloca 10MB/iteracao |
| 15:07:10 | Pod entra em `OOMKilled` (exit code 137) — kernel mata o processo |
| 15:07:12 | Kubernetes reinicia o container — CrashLoopBackOff |
| 15:10:13 | Alertas `ContainerOOMKilled` (Critico/DISPARADO) e `PodCrashLooping` (Critico) disparam |
| 15:10:58 | Pod deletado — servico backend nao foi afetado |

**Alertas disparados:**
- `ContainerOOMKilled` (DISPARADO/Critico) — `pod=oom-demo container=memory-hog reason=OOMKilled`
- `PodCrashLooping` (DISPARADO/Critico) — pod reiniciando continuamente

**Causa raiz:** container alocou mais memoria do que o limite configurado (10Mi). O kernel Linux encerrou o processo via OOM Killer (SIGKILL — exit code 137).

**Como identificar OOMKilled:**
```bash
kubectl describe pod <pod> -n app | grep -A3 "Last State"
# Reason: OOMKilled
# Exit Code: 137

kubectl top pod <pod> -n app
# Ver consumo de memoria proximo ao limite
```

**Resolucao:**
```bash
# Opcao 1 — aumentar o memory limit
kubectl set resources deployment backend \
  --limits=memory=512Mi -n app

# Opcao 2 — deletar o pod com OOM (se for pod standalone)
kubectl delete pod <pod-oomkilled> -n app

# Opcao 3 — rollback do deployment se o OOM foi introduzido por novo codigo
kubectl rollout undo deployment/backend -n app
```

**Diferenca entre Exit Code 1 e Exit Code 137:**
- Exit Code 1 = aplicacao crashou (bug, erro de configuracao)
- Exit Code 137 = kernel matou o processo (OOMKilled ou SIGKILL manual)

**Licao aprendida:** sempre configurar memory `requests` e `limits` baseado no consumo real medido em staging. Usar `kubectl top pod` e dashboards do Grafana para estabelecer baseline antes de ir para producao.
