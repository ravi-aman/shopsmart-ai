import { createBrowserRouter } from 'react-router'
import { AppLayout } from '@/app/AppLayout'
import { AccountPage } from '@/features/account/AccountPage'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { AdminOrdersPage } from '@/features/admin/AdminOrdersPage'
import { AuditPage } from '@/features/admin/AuditPage'
import { InventoryPage } from '@/features/admin/InventoryPage'
import { KnowledgePage } from '@/features/admin/KnowledgePage'
import { OverviewPage } from '@/features/admin/OverviewPage'
import { LoginPage, RegisterPage, RequireAuth } from '@/features/auth/AuthPages'
import { CartPage } from '@/features/cart/CartPage'
import { ListingPage } from '@/features/catalog/ListingPage'
import { ComparePage } from '@/features/compare/ComparePage'
import { HomePage } from '@/features/home/HomePage'
import { ProductPage } from '@/features/product/ProductPage'
import { NotFoundPage } from '@/features/system/NotFoundPage'
import { StatusPage } from '@/features/system/StatusPage'
import { WishlistPage } from '@/features/wishlist/WishlistPage'
import { CheckoutPage } from '@/features/orders/CheckoutPage'
import { OrderDetailPage, OrdersPage } from '@/features/orders/OrdersPages'

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'c/:slug', element: <ListingPage /> },
      { path: 'search', element: <ListingPage /> },
      { path: 'p/:slug', element: <ProductPage /> },
      { path: 'compare', element: <ComparePage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'checkout', element: <CheckoutPage /> },
      { path: 'orders', element: <RequireAuth><OrdersPage /></RequireAuth> },
      { path: 'orders/:id', element: <RequireAuth><OrderDetailPage /></RequireAuth> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'wishlist', element: <RequireAuth><WishlistPage /></RequireAuth> },
      { path: 'account', element: <RequireAuth><AccountPage /></RequireAuth> },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'orders', element: <AdminOrdersPage /> },
          { path: 'inventory', element: <InventoryPage /> },
          { path: 'knowledge', element: <KnowledgePage /> },
          { path: 'audit', element: <AuditPage /> },
        ],
      },
      { path: 'status', element: <StatusPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
