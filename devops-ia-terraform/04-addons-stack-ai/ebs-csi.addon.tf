resource "aws_eks_addon" "ebs_csi" {
  cluster_name                = var.cluster.name
  addon_name                  = "aws-ebs-csi-driver"
  addon_version               = var.ebs_csi.addon_version
  service_account_role_arn    = aws_iam_role.ebs_csi.arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  tags = {
    Component = "ebs-csi-driver"
  }

  depends_on = [aws_iam_role_policy_attachment.ebs_csi]
}
