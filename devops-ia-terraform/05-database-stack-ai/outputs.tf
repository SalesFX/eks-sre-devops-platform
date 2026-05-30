output "db_instance_endpoint" {
  description = "The connection endpoint for the RDS instance (host:port). Use as DB_HOST in the backend ConfigMap."
  value       = aws_db_instance.this.endpoint
}

output "db_instance_address" {
  description = "The hostname of the RDS instance (without port). Use as the db-host key in backend-config ConfigMap."
  value       = aws_db_instance.this.address
}

output "db_instance_resource_id" {
  description = "The RDS resource ID (dbi-resource-id). Used in the rds-db:connect IAM policy ARN."
  value       = aws_db_instance.this.resource_id
}

output "db_master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret storing the RDS master user credentials (managed by RDS)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "backend_irsa_role_arn" {
  description = "ARN of the IAM role for the backend IRSA ServiceAccount annotation (eks.amazonaws.com/role-arn)."
  value       = aws_iam_role.backend_irsa.arn
}
