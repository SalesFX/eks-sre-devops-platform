resource "aws_security_group" "rds" {
  name        = "${var.project.name}-${var.project.environment}-rds"
  description = "Security group for RDS PostgreSQL. Allows inbound 5432 from EKS cluster nodes only."
  vpc_id      = data.terraform_remote_state.networking.outputs.vpc_id

  tags = {
    Component = "rds-security-group"
  }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_eks_nodes" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Allow PostgreSQL traffic from EKS cluster nodes."
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = data.terraform_remote_state.eks.outputs.eks_cluster_security_group_id

  tags = {
    Component = "rds-security-group-ingress"
  }
}

resource "aws_vpc_security_group_egress_rule" "rds_deny_all" {
  security_group_id = aws_security_group.rds.id
  description       = "Deny all outbound traffic from RDS."
  ip_protocol       = "-1"
  cidr_ipv4         = "127.0.0.1/32"

  tags = {
    Component = "rds-security-group-egress"
  }
}
