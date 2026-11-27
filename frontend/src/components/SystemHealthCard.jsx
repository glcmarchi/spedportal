import React, { useState, useEffect } from 'react';
import axios from 'axios';

// Utilizza la variabile d'ambiente del frontend oppure il fallback di produzione Render
const API_BASE = process.env.REACT_APP_BACKEND_URL || 'https://spedportal-api.onrender.com';

export default function SystemHealthCard() {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);
  const [error, setError] = useState(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      // Chiamata all'endpoint di diagnostica profonda
      const response = await axios.get(`${API_BASE}/api/health/deep`, {
        timeout: 10000 // 10 secondi di timeout
      });
      setHealthData(response.data);
      setLastCheck(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Errore durante il recupero della diagnostica:', err);
      setError(
        err.response?.data?.detail || 
        err.message || 
        'Impossibile contattare il server'
      );
    } finally {
      setLoading(false);
    }
  };

  // Esegui la diagnostica al primo caricamento del componente
  useEffect(() => {
    fetchHealth();
  }, []);

  // Helper per renderizzare lo stato con badge colorato
  const renderStatusBadge = (status) => {
    switch (status) {
      case 'operational':
        return (
          <span style={{
            backgroundColor: '#d1fae5',
            color: '#065f46',
            padding: '3px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: '600'
          }}>
            ● Operativo
          </span>
        );
      case 'degraded':
        return (
          <span style={{
            backgroundColor: '#fef3c7',
            color: '#92400e',
            padding: '3px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: '600'
          }}>
            ▲ Rallentato
          </span>
        );
      case 'down':
      case 'unreachable':
        return (
          <span style={{
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            padding: '3px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: '600'
          }}>
            ✖ Offline
          </span>
        );
      default:
        return (
          <span style={{
            backgroundColor: '#f3f4f6',
            color: '#374151',
            padding: '3px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: '600'
          }}>
            {status || 'N/D'}
          </span>
        );
    }
  };

  const services = healthData?.services || {};

  return (
    <div style={{
      backgroundColor: '#ffffff',
      borderRadius: '8px',
      border: '1px solid #e5e7eb',
      padding: '20px',
      marginBottom: '24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
    }}>
      {/* Intestazione Card */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#111827' }}>
            Stato Sistemi & Connessioni
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>
            Diagnostica in tempo reale di Database, Corrieri e Servizi Terzi
          </p>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loading}
          style={{
            padding: '8px 14px',
            backgroundColor: loading ? '#9ca3af' : '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: '500'
          }}
        >
          {loading ? 'Verifica in corso...' : 'Aggiorna Ora'}
        </button>
      </div>

      {/* Messaggio di Errore Generale se il backend non risponde */}
      {error && (
        <div style={{
          padding: '12px',
          backgroundColor: '#fee2e2',
          color: '#b91c1c',
          borderRadius: '6px',
          fontSize: '13px',
          marginBottom: '16px'
        }}>
          Errore di connessione con il backend: {error}
        </div>
      )}

      {/* Griglia dei 4 Servizi Principali */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
        marginTop: '12px'
      }}>
        {/* 1. Database MongoDB */}
        <div style={{ border: '1px solid #f3f4f6', borderRadius: '6px', padding: '12px', backgroundColor: '#fafafa' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: '600', fontSize: '14px', color: '#1f2937' }}>MongoDB Atlas</span>
            {renderStatusBadge(services.database?.status)}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
            Latenza: <strong>{services.database?.latency_ms != null ? `${services.database.latency_ms} ms` : '-'}</strong>
          </div>
        </div>

        {/* 2. Connettore FedEx */}
        <div style={{ border: '1px solid #f3f4f6', borderRadius: '6px', padding: '12px', backgroundColor: '#fafafa' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: '600', fontSize: '14px', color: '#1f2937' }}>FedEx API</span>
            {renderStatusBadge(services.fedex_carrier?.status)}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
            Modo: <strong>{services.fedex_carrier?.mode?.toUpperCase() || '-'}</strong> | Latenza: <strong>{services.fedex_carrier?.latency_ms != null ? `${services.fedex_carrier.latency_ms} ms` : '-'}</strong>
          </div>
        </div>

        {/* 3. Lookup Territoriale CAP */}
        <div style={{ border: '1px solid #f3f4f6', borderRadius: '6px', padding: '12px', backgroundColor: '#fafafa' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: '600', fontSize: '14px', color: '#1f2937' }}>Lookup CAP</span>
            {renderStatusBadge(services.geo_service?.status)}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
            Servizio: <strong>Zippopotam</strong> | Latenza: <strong>{services.geo_service?.latency_ms != null ? `${services.geo_service.latency_ms} ms` : '-'}</strong>
          </div>
        </div>

        {/* 4. Servizio Notifiche / Email */}
        <div style={{ border: '1px solid #f3f4f6', borderRadius: '6px', padding: '12px', backgroundColor: '#fafafa' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: '600', fontSize: '14px', color: '#1f2937' }}>Servizio Email</span>
            {renderStatusBadge(services.email_service?.status)}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
            Latenza: <strong>{services.email_service?.latency_ms != null ? `${services.email_service.latency_ms} ms` : '-'}</strong>
          </div>
        </div>
      </div>

      {/* Footer informativo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '14px', fontSize: '11px', color: '#9ca3af' }}>
        <span>Ambiente: <strong>{healthData?.environment || 'dev'}</strong></span>
        <span>Ultimo controllo: {lastCheck || 'In attesa...'}</span>
      </div>
    </div>
  );
}
