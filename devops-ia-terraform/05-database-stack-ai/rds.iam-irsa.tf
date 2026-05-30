locals {
  oidc_issuer_host = replace(data.aws_iam_openid_connect_provider.eks.url, "https://", "")
}

data "aws_iam_policy_document" "backend_irsa_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.eks.arn]
    }

    actions = ["sts:AssumeRoleWithWebIdentity"]

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:sub"
      values   = ["system:serviceaccount:default:backend"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_issuer_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backend_irsa" {
  name               = "${var.project.name}-${var.project.environment}-backend-irsa"
  assume_role_policy = data.aws_iam_policy_document.backend_irsa_assume_role.json
  description        = "IRSA role for the backend ServiceAccount to authenticate to RDS PostgreSQL via IAM DB auth."

  tags = {
    Component = "backend-irsa-role"
    ADR       = "ADR-0014"
  }
}

data "aws_iam_policy_document" "backend_rds_connect" {
  statement {
    effect  = "Allow"
    actions = ["rds-db:connect"]
    resources = [
      "arn:aws:rds-db:${var.aws_region}:${data.aws_caller_identity.current.account_id}:dbuser:${aws_db_instance.this.resource_id}/app_user"
    ]
  }
}

resource "aws_iam_policy" "backend_rds_connect" {
  name        = "${var.project.name}-${var.project.environment}-backend-rds-connect"
  description = "Allow backend IRSA role to connect to RDS PostgreSQL as app_user via IAM DB authentication."
  policy      = data.aws_iam_policy_document.backend_rds_connect.json

  tags = {
    Component = "backend-irsa-policy"
    ADR       = "ADR-0014"
  }
}

resource "aws_iam_role_policy_attachment" "backend_rds_connect" {
  role       = aws_iam_role.backend_irsa.name
  policy_arn = aws_iam_policy.backend_rds_connect.arn
}
