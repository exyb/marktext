<template>
  <div
    class="right-toc-panel"
    :class="[
      { 'right-toc-overflow': !wordWrapInToc },
      { 'right-toc-wordwrap': wordWrapInToc }
    ]"
  >
    <div class="toc-header">
      <span class="title">{{ t('sideBar.toc.title') }}</span>
      <el-button
        class="close-btn"
        text
        size="small"
        @click="handleClose"
      >
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
    <el-tree
      v-if="toc.length"
      :data="toc"
      :default-expand-all="true"
      :props="defaultProps"
      :expand-on-click-node="false"
      :indent="10"
      @node-click="handleClick"
    ></el-tree>
    <div v-else class="empty-toc">
      {{ t('sideBar.toc.empty') }}
    </div>
  </div>
</template>

<script setup>
import { Close } from '@element-plus/icons-vue'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { useLayoutStore } from '@/store/layout'
import bus from '../../bus'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const layoutStore = useLayoutStore()

const defaultProps = {
  children: 'children',
  label: 'label'
}

const { toc } = storeToRefs(editorStore)
const { wordWrapInToc } = storeToRefs(preferencesStore)

const handleClick = ({ slug }) => {
  bus.emit('scroll-to-header', slug)
}

const handleClose = () => {
  layoutStore.TOGGLE_LAYOUT_ENTRY('showRightToc')
}
</script>

<style scoped>
.right-toc-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--sideBarBgColor);
  border-left: 1px solid var(--floatBorderColor);
  overflow: hidden;
}

.toc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 15px;
  border-bottom: 1px solid var(--floatBorderColor);
  min-height: 45px;
}

.toc-header .title {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
}

.close-btn {
  color: var(--sideBarIconColor);
  padding: 4px;
}

.close-btn:hover {
  color: var(--themeColor);
}

.right-toc-panel .el-tree {
  flex: 1;
  overflow-y: auto;
  background: transparent;
  color: var(--sideBarColor);
  padding: 10px 0;
}

.right-toc-panel .el-tree-node {
  margin-top: 8px;
}

.empty-toc {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--sideBarTextColor);
  font-size: 14px;
  padding: 20px;
  text-align: center;
}

/* Word wrap styles */
.right-toc-wordwrap :deep(.el-tree-node__label) {
  white-space: normal;
  word-wrap: break-word;
}

.right-toc-overflow :deep(.el-tree-node__label) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
