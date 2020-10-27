import Vue from 'vue';
import VueRouter from 'vue-router';
import Xmpp from '../components/xmpp.vue';

Vue.use(VueRouter);

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Xmpp,
  },
];

const router = new VueRouter({
  mode: 'history',
  base: process.env.BASE_URL,
  routes
});

export default router;
