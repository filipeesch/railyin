import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../rpc";
import type { Project } from "@shared/rpc-types";

export const useProjectStore = defineStore("project", () => {
  const projects = ref<Project[]>([]);
  const loading = ref(false);

  async function loadProjects() {
    loading.value = true;
    try {
      projects.value = await api("projects.list", {});
    } finally {
      loading.value = false;
    }
  }

  async function registerProject(params: {
    workspaceKey: string;
    name: string;
    projectPath: string;
    gitRootPath: string;
    defaultBranch: string;
    slug?: string;
    description?: string;
  }) {
    const project = await api("projects.register", params);
    projects.value.push(project);
    return project;
  }

  async function updateProject(params: {
    workspaceKey: string;
    key: string;
    name?: string;
    projectPath?: string;
    gitRootPath?: string;
    defaultBranch?: string;
    slug?: string;
    description?: string;
  }) {
    const project = await api("projects.update", params);
    const idx = projects.value.findIndex((p) => p.key === params.key && p.workspaceKey === params.workspaceKey);
    if (idx >= 0) {
      projects.value[idx] = project;
    }
    return project;
  }

  async function deleteProject(workspaceKey: string, key: string) {
    await api("projects.delete", { workspaceKey, key });
    projects.value = projects.value.filter((p) => !(p.key === key && p.workspaceKey === workspaceKey));
  }

  return { projects, loading, loadProjects, registerProject, updateProject, deleteProject };
});
