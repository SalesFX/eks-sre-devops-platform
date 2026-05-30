resource "aws_db_subnet_group" "this" {
  name        = "${var.project.name}-${var.project.environment}"
  description = "RDS subnet group for ${var.project.name} ${var.project.environment} using private subnets."
  subnet_ids  = data.terraform_remote_state.networking.outputs.private_subnet_ids

  tags = {
    Component = "rds-subnet-group"
  }

  lifecycle {
    prevent_destroy = true
  }
}
