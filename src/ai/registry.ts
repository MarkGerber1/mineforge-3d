export interface UiComponentMeta {
  id: string;
  name: string;
  file: string;
}

export const UI_REGISTRY: UiComponentMeta[] = [
  { id: "topbar", name: "Верхняя панель", file: "src/components/app/TopBar.tsx" },
  { id: "sidebar", name: "Боковая панель инструментов", file: "src/components/app/LeftSidebar.tsx" },
  { id: "command", name: "Командная строка", file: "src/components/app/CommandBar.tsx" },
  { id: "inspector", name: "Инспектор свойств", file: "src/components/app/Inspector.tsx" },
  { id: "grok", name: "Grok Assistant", file: "src/components/app/GrokPanel.tsx" },
  { id: "hud", name: "REQUESTED / SAFE HUD", file: "src/components/app/MobileHud.tsx" },
  { id: "bottombar", name: "Инженерная панель", file: "src/components/app/BottomBar.tsx" },
  { id: "toolbar", name: "Мобильный тулбар", file: "src/components/app/MobileToolbar.tsx" },
  { id: "workspace", name: "CAD / Digital Twin", file: "src/components/app/Workspace.tsx" },
  { id: "cad", name: "2D CAD", file: "src/components/cad/Cad2D.tsx" },
  { id: "twin", name: "3D Digital Twin", file: "src/components/twin/Twin3D.tsx" },
  { id: "reality", name: "Reality Sync", file: "src/components/reality/RealityPanel.tsx" },
];

export function findUiComponent(id: string): UiComponentMeta | undefined {
  return UI_REGISTRY.find((c) => c.id === id);
}
