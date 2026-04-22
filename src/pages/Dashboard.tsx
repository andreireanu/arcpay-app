import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useAuth } from '../hooks/useAuth'
import { useRegister } from '../hooks/useRegister'
import { getProducts } from '../supabase/products'
import type { Product } from '../types/product'

export default function Dashboard() {
  const { session, signOutUser } = useAuth()
  const { register, registering, connected } = useRegister()
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    getProducts().then(setProducts).catch(console.error)
  }, [])

  async function handleSignOut() {
    await signOutUser()
    navigate('/login')
  }

  async function handleRegister() {
    const signature = await register()
    if (signature) console.log('registered:', signature)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50 m-0">
            Dashboard
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {session?.user.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <WalletMultiButton />
          <button
            onClick={handleSignOut}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="px-6 py-8 max-w-5xl mx-auto">
        <section className="border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-950 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-5">
            Products
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => (
              <div
                key={product.id}
                className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col gap-3 hover:shadow-md transition-shadow"
              >
                {product.image_url && (
                  <div className="w-full aspect-video rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-50 text-base">
                    {product.name}
                  </h3>
                  {product.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {product.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={handleRegister}
                  disabled={!connected || registering}
                  className="w-full py-2 px-4 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  {registering ? 'Registering…' : 'Register'}
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
