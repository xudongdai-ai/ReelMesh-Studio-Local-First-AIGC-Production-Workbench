function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function organizationRow(row) {
  return row && {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerAdminId: row.owner_admin_id,
    createdAt: row.created_at,
  };
}

export function invitationRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    role: row.role,
    department: row.department,
    parentId: row.parent_id,
    parentName: row.parent_name || "未设置",
    maxUses: row.max_uses,
    useCount: row.use_count,
    remainingUses: Math.max(0, Number(row.max_uses || 0) - Number(row.use_count || 0)),
    requiresApproval: Boolean(row.requires_approval),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name || "未设置",
    createdAt: row.created_at,
  };
}

export function projectRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id || row.organization_id,
    name: row.name,
    type: row.type,
    aspectRatio: row.aspect_ratio,
    style: row.style,
    description: row.description,
    stage: row.stage,
    progress: row.progress,
    cover: row.cover_url,
    ownerId: row.owner_user_id || row.owner_id,
    ownerUserId: row.owner_user_id || row.owner_id,
    organizationId: row.org_id || row.organization_id,
    createdAt: row.created_at,
  };
}

export function weddingWorkflowRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    currentStep: Number(row.current_step || 1),
    status: row.status || "进行中",
    completedSteps: parseJson(row.completed_steps_json, []),
    notes: parseJson(row.notes_json, {}),
    story: parseJson(row.story_json, {}),
    imageTaskIds: parseJson(row.image_task_ids_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assetRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    type: row.type,
    typeLabel: row.type_label,
    name: row.name,
    code: row.code,
    version: row.version,
    status: row.status,
    prompt: row.prompt,
    notes: row.notes,
    filename: row.filename,
    image: row.thumbnail_url || row.image_url,
    imageFull: row.image_full_url || row.image_url,
    thumbnailUrl: row.thumbnail_url,
    createdAt: row.created_at,
  };
}

export function assetFolderRow(row) {
  return row && {
    id: row.id,
    organizationId: row.org_id,
    projectId: row.project_id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function imageResultRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    taskId: row.generation_job_id || row.task_id,
    generationJobId: row.generation_job_id || row.task_id,
    label: row.label,
    full: row.full_url,
    thumb: row.thumb_url,
    discarded: !!row.discarded_at,
    createdAt: row.created_at,
  };
}

export function imageTaskRow(row, results = []) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    assetId: row.asset_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    type: row.type,
    ratio: row.ratio,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    style: row.style,
    modelName: row.model_name,
    provider: row.provider,
    mediaKind: row.media_kind || "image",
    providerJobId: row.provider_job_id || null,
    durationSeconds: row.duration_seconds || null,
    batchCount: row.batch_count || 4,
    outputUrl: row.output_file_path ? `/api/generation-jobs/${encodeURIComponent(row.id)}/content` : null,
    seed: row.seed,
    generationCost: row.generation_cost,
    status: row.status,
    progress: row.progress,
    selectedResultId: row.selected_result_id,
    discardedResultIds: results.filter((item) => item.discarded).map((item) => item.id),
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    results,
    createdAt: row.created_at,
  };
}

export function shotRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    number: row.number,
    sceneName: row.scene_name,
    duration: row.duration,
    shotSize: row.shot_size,
    camera: row.camera,
    characters: parseJson(row.characters_json, []),
    sceneAsset: row.scene_asset,
    props: parseJson(row.props_json, []),
    action: row.action,
    dialogue: row.dialogue,
    stillPrompt: row.still_prompt,
    videoPrompt: row.video_prompt,
    assetIds: parseJson(row.asset_ids_json, []),
    status: row.status,
  };
}

export function assignmentRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    managerId: row.assigned_by || row.manager_id,
    managerName: row.manager_name,
    assignedBy: row.assigned_by || row.manager_id,
    assigneeId: row.assigned_to || row.assignee_id,
    assignedTo: row.assigned_to || row.assignee_id,
    assigneeName: row.assignee_name,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function auditRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    userId: row.actor_account_id || row.user_id,
    user: row.user_name,
    action: row.action,
    target: row.target,
    project: row.project,
    status: row.status,
    time: new Date(row.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    createdAt: row.created_at,
  };
}

export function fileRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    assetId: row.asset_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id || row.owner_id,
    kind: row.kind,
    assetType: row.asset_type,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    originalUrl: row.original_url,
    previewUrl: row.preview_url,
    thumbnailUrl: row.thumbnail_url,
    version: row.version,
    createdAt: row.created_at,
  };
}

export function skillTemplateRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    key: row.template_key,
    templateKey: row.template_key,
    name: row.name,
    type: row.type,
    description: row.description,
    assetTypeLabel: row.asset_type_label,
    recommendedRatio: row.recommended_ratio,
    fields: parseJson(row.fields_json, []),
    checklist: parseJson(row.checklist_json, []),
    sourceContent: row.source_content || "",
    sourceFiles: parseJson(row.source_files_json, []),
    version: row.version,
    status: row.status,
    scope: row.scope,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function productionSpecRow(row) {
  return row && {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    templateId: row.template_id,
    templateKey: row.template_key,
    templateVersion: row.template_version,
    ownerUserId: row.owner_user_id,
    title: row.title,
    type: row.type,
    assetTypeLabel: row.asset_type_label,
    content: row.content,
    notes: row.notes,
    status: row.status,
    linkedAssetId: row.linked_asset_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
