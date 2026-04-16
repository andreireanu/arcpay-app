import { useAuth } from '../hooks/useAuth'
import { useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const { session, signOutUser } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOutUser()
    navigate('/login')
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome, {session?.user.email}</p>
      <button onClick={handleSignOut}>Sign out</button>
    </div>
  )
}
