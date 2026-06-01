# Agentes Especializados

Este projeto usa Claude Code com agentes especializados definidos em `.claude/agents/`. Cada agente tem um papel especifico e restricoes claras — o arquiteto nunca escreve codigo, o platform engineer nunca toma decisoes arquiteturais sem um ADR aprovado.

## Agentes

### devops-solution-architect

Planeja arquiteturas, avalia trade-offs e produz Architecture Decision Records (ADRs). Nunca cria arquivos `.tf`, manifestos Kubernetes ou codigo de aplicacao. Invocado antes de qualquer implementacao para estruturar o problema e registrar a decisao.

Entregaveis: `docs/ADR-XXXX-titulo.md`

### devops-senior-engineer (Platform Engineer)

Le os ADRs aprovados pelo arquiteto e implementa a solucao em IaC (Terraform), manifestos Kubernetes ou configuracoes de pipeline. Segue rigorosamente as convencoes de nomenclatura e estrutura definidas em `.claude/rules/`.

Entregaveis: `docs/implementation/IMPL-ADR-XXXX-YYYY-MM-DD.md`

### devsecops-senior-engineer

Revisa codigo, arquivos Terraform, manifestos Kubernetes, Dockerfiles e GitHub Actions buscando segredos expostos, credenciais estaticas e configuracoes perigosas. Deve ser invocado antes de qualquer commit ou push.

Entregavel: veredicto estruturado `APPROVED` ou `BLOQUEADO` com lista de achados classificados por severidade.

### postgres-rds-db-senior

Especialista no banco de dados RDS PostgreSQL. Cobre decisoes de arquitetura de banco, modulos Terraform para RDS, seguranca sem acesso publico e sem segredos no Git, integracao com o backend via IRSA, observabilidade e runbooks de incidente.

## Por que agentes separados

Cada agente tem um contexto diferente, restricoes diferentes e entregaveis diferentes. Um agente de arquitetura que pudesse escrever codigo tenderia a pular a fase de design. Um agente de implementacao que tomasse decisoes arquiteturais produziria inconsistencias ao longo do tempo. A separacao forcou boas praticas de engenharia durante o desenvolvimento do proprio projeto.
