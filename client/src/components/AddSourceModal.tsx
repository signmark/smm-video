const parseSource = async () => {
    if (!url) {
      setError('Введите URL');
      return;
    }

    try {
      setParsing(true);
      setError(null);

      const token = localStorage.getItem('auth_token');

      const response = await fetch('/api/sources/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          url,
          sourceType: sourceType
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.message || 'Ошибка при парсинге');
        return;
      }

      const data = await response.json();
      setParsedData(data);
      setParsing(false);
    } catch (error) {
      setError('Ошибка при парсинге');
      setParsing(false);
    }
  };