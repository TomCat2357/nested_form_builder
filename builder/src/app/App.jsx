import React from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { AppDataProvider } from "./state/AppDataProvider.jsx";
import MainPage from "../pages/MainPage.jsx";
import SearchPage from "../pages/SearchPage.jsx";
import FormPage from "../pages/FormPage.jsx";
import AdminDashboardPage from "../pages/AdminDashboardPage.jsx";
import AdminFormEditorPage from "../pages/AdminFormEditorPage.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";

export default function App() {
  return (
    <AppDataProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/form/:formId/new" element={<FormPage />} />
          <Route path="/form/:formId/entry/:entryId" element={<FormPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/forms/new" element={<AdminFormEditorPage />} />
          <Route path="/admin/forms/:formId/edit" element={<AdminFormEditorPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </HashRouter>
    </AppDataProvider>
  );
}
