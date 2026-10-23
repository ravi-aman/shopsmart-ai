import { createBrowserRouter, Navigate } from 'react-router'
import { AppLayout } from '@/app/AppLayout'
import { AccountPage } from '@/features/account/AccountPage'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { KnowledgePage } from '@/features/admin/KnowledgePage'
import { LoginPage, RegisterPage, RequireAuth } from '@/features/auth/AuthPages'
import { CartPage } from '@/features/cart/CartPage'
import { ListingPage } from '@/features/catalog/ListingPage'
import { ComparePage } from '@/features/compare/ComparePage'
import { HomePage } from '@/features/home/HomePage'
import { ProductPage } from '@/features/product/ProductPage'
import { NotFoundPage } from '@/features/system/NotFoundPage'
import { StatusPage } from '@/features/system/StatusPage'
import { WishlistPage } from '@/features/wishlist/WishlistPage'

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
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'wishlist', element: <RequireAuth><WishlistPage /></RequireAuth> },
      { path: 'account', element: <RequireAuth><AccountPage /></RequireAuth> },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <Navigate to="knowledge" replace /> },
          { path: 'knowledge', element: <KnowledgePage /> },
        ],
      },
      { path: 'status', element: <StatusPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
