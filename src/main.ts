import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './index.vue'
import './assets/theme.css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'

// 说明：应用主体仍由 index.vue 依据登录态与当前路由条件渲染，
// 这里的路由仅用于驱动 URL（#/ 对话、#/files 文件管理），路由组件为占位。
const blank = { render: () => null }

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: blank },
    { path: '/chat/:id', name: 'chat', component: blank },
    { path: '/files', name: 'files', component: blank },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

createApp(App).use(router).mount('#app')
