import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LocaleProvider } from './i18n';
import { AboutData } from './screens/AboutData';
import { Home } from './screens/Home';
import { Live } from './screens/Live';
import { Results } from './screens/Results';
import { Saved } from './screens/Saved';
import { Search } from './screens/Search';
import { Trip } from './screens/Trip';

export function App() {
  return (
    <LocaleProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="search" element={<Search />} />
            <Route path="plan" element={<Results />} />
            <Route path="trip/:id" element={<Trip />} />
            <Route path="trip/:id/live" element={<Live />} />
            <Route path="saved" element={<Saved />} />
            <Route path="sources" element={<AboutData />} />
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LocaleProvider>
  );
}
